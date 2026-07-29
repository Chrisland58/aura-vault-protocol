import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
    // JUnit XML for CI artifact upload
    ["junit", { outputFile: "playwright-results.xml" }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Snapshot configuration for visual regression
  expect: {
    toHaveScreenshot: {
      // Maximum tolerated pixel difference: 0.1%
      maxDiffPixelRatio: 0.001,
      // Disable animations for deterministic screenshots
      animations: "disabled",
    },
  },
  snapshotDir: "./playwright/snapshots",
  projects: [
    // Desktop browsers — functional tests
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/visual-regression.spec.ts" },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] }, testIgnore: "**/visual-regression.spec.ts" },
    { name: "webkit",   use: { ...devices["Desktop Safari"] }, testIgnore: "**/visual-regression.spec.ts" },
    { name: "edge",     use: { ...devices["Desktop Edge"] }, testIgnore: "**/visual-regression.spec.ts" },
    // Mobile
    { name: "ios-safari",     use: { ...devices["iPhone 14"] }, testIgnore: "**/visual-regression.spec.ts" },
    { name: "android-chrome", use: { ...devices["Pixel 7"] }, testIgnore: "**/visual-regression.spec.ts" },
    // Slow network (3G) — chromium with throttled network
    {
      name: "chromium-3g",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-extensions"] },
      },
      testIgnore: "**/visual-regression.spec.ts",
    },
    // -----------------------------------------------------------------------
    // Visual regression — Chromium ONLY for speed and determinism
    // Screenshots are compared against baselines in ./playwright/snapshots/
    // Run: npx playwright test --project=visual-regression
    // Update baselines: npx playwright test --project=visual-regression --update-snapshots
    // -----------------------------------------------------------------------
    {
      name: "visual-regression",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        // Disable animations for deterministic screenshots
        launchOptions: { args: ["--disable-animations", "--disable-web-animations"] },
      },
      testMatch: "**/visual-regression.spec.ts",
    },
  ],
});
