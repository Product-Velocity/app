import { defineConfig } from "@playwright/test";

/**
 * Browser tests run against a production build made with NEXT_PUBLIC_E2E_HARNESS=1,
 * which turns on the in-memory test page at /dev/grid (see e2e/README in docs).
 * Set PW_CHROMIUM to use an already installed Chromium.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3300",
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
    viewport: { width: 1600, height: 900 },
  },
  webServer: {
    command: "pnpm exec next start -p 3300",
    url: "http://localhost:3300/dev/grid?n=5",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
