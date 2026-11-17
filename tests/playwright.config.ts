import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", locale: "fa-IR", timezoneId: "Asia/Tehran", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
  // exactOptionalPropertyTypes: omit the key entirely rather than assigning undefined.
  ...(process.env.E2E_BASE_URL ? {} : { webServer: { command: "pnpm -w dev", url: "http://localhost:3000/healthz", reuseExistingServer: true, timeout: 180_000 } }),
});
