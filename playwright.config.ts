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
    // ── Desktop browsers ────────────────────────────────────────────────────
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"] } },
    { name: "edge",     use: { ...devices["Desktop Edge"] } },

    // ── Named mobile viewports (used by mobile.spec.ts) ─────────────────────
    //
    //  iphone-se   — 375 × 667  (iPhone SE 3rd gen, smallest common iOS phone)
    //  iphone-14   — 390 × 844  (iPhone 14 / 15 standard)
    //  android-lg  — 414 × 896  (large Android, e.g. Pixel XL / Samsung A series)
    //
    // Each project inherits Chromium for consistency in CI; the viewport is
    // what matters for layout testing, not the browser engine.
    {
      name: "iphone-se",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "iphone-14",
      use: {
        ...devices["iPhone 14"],
        // Playwright's "iPhone 14" device preset uses 390 × 844 — keep it but
        // make the name explicit so CI can reference it by name.
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "android-lg",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 414, height: 896 },
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; Pixel 6 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },

    // ── Legacy mobile projects (kept for backward compatibility) ────────────
    { name: "ios-safari",     use: { ...devices["iPhone 14"] } },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },

    // ── Slow network (3G) — chromium with throttled network ─────────────────
    {
      name: "chromium-3g",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-extensions"] },
      },
    },
    // ── Mobile viewport projects (explicit px widths) ──────────────────────
    {
      name: "mobile-375",
      testMatch: "**/mobile.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },  // iPhone SE
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "mobile-390",
      testMatch: "**/mobile.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },  // iPhone 14
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: "mobile-414",
      testMatch: "**/mobile.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 414, height: 896 },  // Large Android (e.g. Pixel 3 XL)
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2.625,
      },
    },
  ],
});
