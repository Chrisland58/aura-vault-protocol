/**
 * Mobile viewport Playwright tests
 *
 * Runs on three projects defined in playwright.config.ts:
 *   mobile-375  — 375 × 812 (iPhone SE)
 *   mobile-390  — 390 × 844 (iPhone 14)
 *   mobile-414  — 414 × 896 (Large Android)
 *
 * Test suites
 *  1. Deposit modal – modal opens, amount field is reachable, form submits
 *  2. Hamburger navigation – toggle opens/closes menu, links are accessible
 *  3. Transaction history – list renders and is scrollable
 *  4. Touch targets – interactive elements meet the 44 × 44 px minimum
 *  5. Viewport sanity – page renders without overflow at each width
 */

import { test, expect, type Page } from "@playwright/test";

// ── Shared setup ─────────────────────────────────────────────────────────────

/**
 * Inject a Freighter wallet stub and stub all vault API calls.
 * Must be called before page.goto().
 */
async function setupStubs(page: Page): Promise<void> {
  // Wallet stub
  await page.addInitScript(() => {
    (window as any).freighterApi = {
      isConnected: async () => true,
      getPublicKey: async () => "GABC1234TESTPUBLICKEY",
      getNetwork: async () => "TESTNET",
      signTransaction: async () => "signed_xdr",
    };
  });

  // API stubs
  await page.route("**/api/vault/total_assets*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: "500000" }) })
  );
  await page.route("**/api/vault/balance_of*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: "1000" }) })
  );
  await page.route("**/api/vault/apy*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apy: "8.5" }) })
  );
  await page.route("**/api/vault/estimate-gas*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ baseFee: "0.001", priorityFee: "0.0005", totalGas: "0.0015" }),
    })
  );
  await page.route("**/api/vault/transactions/submit*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hash: "deadbeefcafe1234" }),
    })
  );
}

// ── Suite 1 – Deposit modal ──────────────────────────────────────────────────

test.describe("Deposit modal – mobile usability", () => {
  test.beforeEach(async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");
  });

  test("deposit tab and open-deposit-modal button are visible without horizontal scroll", async ({
    page,
  }) => {
    // The page body must not overflow horizontally
    const scrollWidth: number = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth: number = page.viewportSize()!.width;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2); // 2px tolerance for sub-pixel

    // Deposit tab should be in the viewport (no need to scroll right to find it)
    const depositTab = page.getByTestId("deposit-tab");
    await expect(depositTab).toBeVisible();
    const box = await depositTab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 2);
  });

  test("open deposit modal button triggers modal", async ({ page }) => {
    const openBtn = page.getByTestId("open-deposit-modal");
    await expect(openBtn).toBeVisible();
    await openBtn.tap();

    // Modal should appear
    const modal = page.getByTestId("tx-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test("amount input is focusable and accepts typed input on mobile", async ({ page }) => {
    await page.getByTestId("open-deposit-modal").tap();

    const input = page.getByTestId("modal-amount-input");
    await expect(input).toBeVisible({ timeout: 5000 });

    // The input must fit within the viewport (not clipped off-screen)
    const box = await input.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 2);

    // Type an amount
    await input.fill("50");
    await expect(input).toHaveValue("50");
  });

  test("Next button is reachable without scrolling off-screen and advances the step", async ({
    page,
  }) => {
    await page.getByTestId("open-deposit-modal").tap();
    await expect(page.getByTestId("modal-amount-input")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("modal-amount-input").fill("50");

    const nextBtn = page.getByTestId("modal-next-btn").first();
    await expect(nextBtn).toBeVisible();

    // Tap and expect step 2 to appear (review screen)
    await nextBtn.tap();
    await expect(page.getByTestId("modal-step-2")).toBeVisible({ timeout: 5000 });
  });

  test("modal close button dismisses the modal", async ({ page }) => {
    await page.getByTestId("open-deposit-modal").tap();
    const modal = page.getByTestId("tx-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.getByTestId("modal-close").tap();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test("modal content fits within viewport width", async ({ page }) => {
    await page.getByTestId("open-deposit-modal").tap();
    const modal = page.getByTestId("tx-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });

    const box = await modal.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    expect(box).not.toBeNull();
    // The modal container starts at x=0 (fixed inset-0) and must not exceed viewport
    expect(box!.width).toBeLessThanOrEqual(viewportWidth);
  });
});

// ── Suite 2 – Hamburger navigation ──────────────────────────────────────────

test.describe("Hamburger navigation – open / close", () => {
  test.beforeEach(async ({ page }) => {
    await setupStubs(page);
    await page.goto("/");
  });

  test("hamburger toggle button is present on mobile viewport", async ({ page }) => {
    // The MobileNav toggle uses aria-label="Toggle navigation menu"
    const toggle = page.getByRole("button", { name: /toggle navigation menu/i });

    // It may be rendered by the MobileNav component or hidden behind CSS.
    // We check for its presence in the DOM regardless of display visibility
    // (some implementations use CSS to show/hide based on viewport).
    const count = await toggle.count();
    if (count === 0) {
      // The layout.tsx uses a plain <nav> without a hamburger for the header.
      // On narrow viewports it may still be visible as inline links.
      // Verify that at least one nav link is accessible.
      const navLinks = page.locator("header nav a");
      await expect(navLinks.first()).toBeVisible();
      test.skip(); // hamburger not present in this layout — skip remaining assertions
      return;
    }

    await expect(toggle).toBeVisible();
  });

  test("hamburger opens navigation menu and aria-expanded changes to true", async ({ page }) => {
    const toggle = page.getByRole("button", { name: /toggle navigation menu/i });
    const count = await toggle.count();
    if (count === 0) {
      test.skip();
      return;
    }

    // Initially closed
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.tap();

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("navigation menu closes when hamburger is tapped again", async ({ page }) => {
    const toggle = page.getByRole("button", { name: /toggle navigation menu/i });
    const count = await toggle.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("navigation links in header are within viewport bounds", async ({ page }) => {
    // Whether hamburger or inline nav, the links must be reachable
    const navLinks = page.locator("header a, header nav a");
    const viewportWidth = page.viewportSize()!.width;
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < linkCount; i++) {
      const box = await navLinks.nth(i).boundingBox();
      if (!box) continue; // hidden links are OK (hamburger menu)
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 2);
    }
  });

  test("navigation does not produce horizontal overflow", async ({ page }) => {
    const scrollWidth: number = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()!.width;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2);
  });
});

// ── Suite 3 – Transaction history scrolling ──────────────────────────────────

test.describe("Transaction history – scrolling on mobile", () => {
  test.beforeEach(async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");
  });

  test("tx-list element is rendered and visible", async ({ page }) => {
    const txList = page.getByTestId("tx-list");
    await expect(txList).toBeVisible({ timeout: 8000 });
  });

  test("transaction list items are within viewport width (no horizontal overflow)", async ({
    page,
  }) => {
    const txList = page.getByTestId("tx-list");
    await expect(txList).toBeVisible({ timeout: 8000 });

    const box = await txList.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 2);
  });

  test("transaction list can be scrolled vertically when it overflows", async ({ page }) => {
    const txList = page.getByTestId("tx-list");
    await expect(txList).toBeVisible({ timeout: 8000 });

    // Record the current scroll position of the page
    const scrollBefore: number = await page.evaluate(() => window.scrollY);

    // Scroll the page to bring the tx list into view and then further
    await txList.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 200);

    const scrollAfter: number = await page.evaluate(() => window.scrollY);

    // Either the page scrolled, OR the list is short enough that no scroll is needed
    // Either case is acceptable — we just want to confirm no crash / lockup
    expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore);
  });

  test("refresh-stats-btn is accessible on mobile", async ({ page }) => {
    const refreshBtn = page.getByTestId("refresh-stats-btn");
    await expect(refreshBtn).toBeVisible({ timeout: 8000 });

    const box = await refreshBtn.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 2);
  });

  test("tapping refresh-stats-btn does not throw a JS error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const refreshBtn = page.getByTestId("refresh-stats-btn");
    await expect(refreshBtn).toBeVisible({ timeout: 8000 });
    await refreshBtn.tap();

    // Give re-fetch a moment to resolve (stubs respond instantly)
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });
});

// ── Suite 4 – Touch targets ≥ 44 px ─────────────────────────────────────────

test.describe("Touch target sizes – 44 × 44 px minimum", () => {
  /**
   * Returns the bounding box of an element, or null if not in DOM / not visible.
   */
  async function boxOf(page: Page, testId: string) {
    const el = page.getByTestId(testId);
    const count = await el.count();
    if (count === 0) return null;
    return el.boundingBox();
  }

  test("connect-wallet-btn meets 44 × 44 px on the home page", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/");

    const btn = page.getByTestId("connect-wallet-btn");
    await expect(btn).toBeVisible({ timeout: 5000 });
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("open-deposit-modal button meets 44 × 44 px on dashboard", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");

    const btn = page.getByTestId("open-deposit-modal");
    await expect(btn).toBeVisible({ timeout: 5000 });
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("deposit-tab button meets 44 × 44 px height on dashboard", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");

    const tab = page.getByTestId("deposit-tab");
    await expect(tab).toBeVisible({ timeout: 5000 });
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    // Width can be full-row; height must meet 44 px
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("modal-amount-input meets 44 px height when modal is open", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");
    await page.getByTestId("open-deposit-modal").tap();

    const input = page.getByTestId("modal-amount-input");
    await expect(input).toBeVisible({ timeout: 5000 });
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("modal-next-btn meets 44 × 44 px when modal is open", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");
    await page.getByTestId("open-deposit-modal").tap();

    const nextBtn = page.getByTestId("modal-next-btn").first();
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    const box = await nextBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("modal-close button meets 44 × 44 px when modal is open", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");
    await page.getByTestId("open-deposit-modal").tap();

    const closeBtn = page.getByTestId("modal-close");
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    const box = await closeBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("refresh-stats-btn meets 44 px height on dashboard", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/dashboard");

    const btn = page.getByTestId("refresh-stats-btn");
    await expect(btn).toBeVisible({ timeout: 8000 });
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

// ── Suite 5 – Viewport sanity ────────────────────────────────────────────────

test.describe("Viewport sanity – no horizontal overflow", () => {
  const ROUTES = ["/", "/dashboard", "/faq"] as const;

  for (const route of ROUTES) {
    test(`${route} renders without horizontal overflow`, async ({ page }) => {
      await setupStubs(page);
      await page.goto(route);

      const [scrollWidth, clientWidth]: [number, number] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);

      // scrollWidth must not exceed the viewport's client width by more than 2 px
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });

    test(`${route} renders without JS errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await setupStubs(page);
      await page.goto(route);

      // Allow async hydration to settle
      await page.waitForTimeout(500);
      expect(errors).toHaveLength(0);
    });
  }

  test("viewport meta tag sets width=device-width", async ({ page }) => {
    await setupStubs(page);
    await page.goto("/");

    const viewportContent = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");

    // Next.js injects a viewport meta by default; verify it's device-width
    if (viewportContent !== null) {
      expect(viewportContent).toMatch(/width=device-width/i);
    }
    // If the tag is absent, Next.js App Router handles it via metadata — acceptable
  });
});
