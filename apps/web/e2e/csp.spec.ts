import { test, expect } from "@playwright/test";

/**
 * Every page carries a Content-Security-Policy (src/proxy.ts), and nothing the
 * app itself does trips it: a violation here would mean a script, style, font,
 * worker or frame the policy forgot, which the browser then silently blocks.
 */
for (const path of ["/", "/lesson/rl101?finish=1"]) {
  test(`${path} is served under a CSP that it does not violate`, async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content.Security.Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
    const res = await page.goto(path);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'self'");
    if (path.startsWith("/lesson")) {
      await expect(page.locator('[data-item-id="title"]')).toContainText("Reinforcement Learning 101");
      await expect(page.locator('[data-item-id="loop"] .katex')).toHaveCount(3);
      await expect(page.locator('[data-item-id="demo_model"] iframe')).toBeVisible();
    } else {
      await expect(page.getByLabel("What do you want to learn")).toBeVisible();
    }
    await page.waitForTimeout(1500);
    expect(violations).toEqual([]);
  });
}
