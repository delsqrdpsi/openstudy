import { test, expect } from "@playwright/test";

test("fixture lesson renders the whole board", async ({ page }) => {
  await page.goto("/lesson/rl101?finish=1");
  await expect(page.locator('[data-item-id="title"]')).toContainText("Reinforcement Learning 101");
  // Columns: blocks in column 1 sit to the right of column 0.
  const t = await page.locator('[data-item-id="title"]').boundingBox();
  const c = await page.locator('[data-item-id="compare_table"]').boundingBox();
  expect(c!.x - t!.x).toBeGreaterThan(300);
  // Math rendered.
  await expect(page.locator('[data-item-id="loop"] .katex')).toHaveCount(3);
  // Images swapped in, annotations drawn, svg sketched.
  await expect(page.locator('[data-item-id="loop_sketch"] img')).toBeVisible();
  await expect(page.locator('[data-item-id="loop"] svg path')).toHaveCount(1);
  await expect(page.locator('[data-item-id="perf_chart"] [data-wb="geometry"] path').first()).toBeVisible();
  await page.getByLabel("Fit board").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/board-finished.png" });
});

test("playback streams text and the caret shows", async ({ page }) => {
  await page.goto("/lesson/rl101?autoplay=0");
  await page.getByLabel("Playback speed").selectOption("4");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator('[data-item-id="big_picture"] .wb-html')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/board-playing.png" });
  await expect(page.locator('[data-item-id="loop_sketch"] .wb-dotcloud')).toBeVisible();
});
