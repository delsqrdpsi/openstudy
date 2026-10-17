import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1600, height: 1000 },
    // Use a system Chromium when one is provided (cloud sandboxes), else Playwright's own.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  webServer: {
    // Point the app at a dead tutor port so tests never start real lessons.
    command: "NEXT_PUBLIC_TUTOR_WS=ws://127.0.0.1:9/ws NEXT_PUBLIC_TUTOR_HTTP=http://127.0.0.1:9 pnpm exec next dev -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
