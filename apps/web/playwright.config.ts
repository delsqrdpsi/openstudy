import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  // One at a time: the live tests start and stop a fake tutor on a fixed port.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1600, height: 1000 },
    // Use a system Chromium when one is provided (cloud sandboxes), else Playwright's own.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  webServer: {
    // The app talks to port 9311, where the live tests run a fake tutor (e2e/fake-tutor.cjs).
    // Everywhere else nothing listens there, so no test ever starts a real lesson.
    command: "NEXT_PUBLIC_TUTOR_WS=ws://127.0.0.1:9311/ws NEXT_PUBLIC_TUTOR_HTTP=http://127.0.0.1:9311 pnpm exec next dev -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
