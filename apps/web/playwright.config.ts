import { defineConfig, devices } from "@playwright/test";

// Runs against the fully offline stack (merchant + core with fakes + `next start`) on its own ports.
const WEB = Number(process.env.E2E_WEB_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB}`,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "bun ../../scripts/dev-offline.ts --prod",
    url: `http://localhost:${WEB}/api/core/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { OFFLINE_WEB_PORT: String(WEB), OFFLINE_CORE_PORT: "8887", OFFLINE_MERCHANT_PORT: "8701" },
  },
});
