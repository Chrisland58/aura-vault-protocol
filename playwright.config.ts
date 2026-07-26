import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Components use data-cy="…" for test hooks.
    // Setting testIdAttribute lets page.getByTestId("x") resolve [data-cy="x"].
    testIdAttribute: "data-cy",
  },
  projects: [
    // -----------------------------------------------------------------------
    // Full user-journey suite — single browser, strict 60-second budget
    // Run with: npx playwright test --project=user-journey
    // -----------------------------------------------------------------------
    {
      name: "user-journey",
      testMatch: "**/user-journey.spec.ts",
      timeout: 60_000,
      use: {
        ...devices["Desktop Chrome"],
        // Disable animations so UI transitions don't eat into the time budget
        reducedMotion: "reduce",
        // Viewport keeps the full desktop layout visible
        viewport: { width: 1280, height: 720 },
      },
    },

    // -----------------------------------------------------------------------
    // Cross-browser / responsive matrix (all other specs)
    // -----------------------------------------------------------------------
    // Desktop browsers
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"] } },
    { name: "edge",     use: { ...devices["Desktop Edge"] } },
    // Mobile
    { name: "ios-safari",     use: { ...devices["iPhone 14"] } },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
    // Slow network (3G) — chromium with throttled network
    {
      name: "chromium-3g",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-extensions"] },
      },
    },
  ],
});
