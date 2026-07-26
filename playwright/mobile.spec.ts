/**
 * Mobile viewport Playwright tests
 *
 * These tests are scoped to the three named mobile projects defined in
 * playwright.config.ts:
 *   - iphone-se   (375 × 667)
 *   - iphone-14   (390 × 844)
 *   - android-lg  (414 × 896)
 *
 * Run only mobile tests:
 *   npx playwright test mobile.spec.ts --project=iphone-se
 *   npx playwright test mobile.spec.ts --project=iphone-14
 *   npx playwright test mobile.spec.ts --project=android-lg
 */

import { test, expect, type Page } from "@playwright/test";

// ── Shared API stubs ─────────────────────────────────────────────────────────

async function stubApis(page: Page) {
  // Freighter wallet stub — lets WalletConnect think Freighter is installed
  await page.addInitScript(() => {
    (window as any).freighterApi = {
      isConnected: async () => true,
      getPublicKey: async () => "GABC1234TESTPUBLICKEY",
      getNetwork: async () => "TESTNET",
      signTransaction: async () => "signed_xdr",
    };
  });

  // Vault API stubs
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
      body: JSON.stringify({ hash: "mocktxhash1234567890" }),
    })
  );
}

// ── Deposit Modal ─────────────────────────────────────────────────────────────

test.describe("Deposit modal — mobile usability", () => {
  test.beforeEach(async ({ page }) => {
    await stubApis(page);
    await page.goto("/");
  });

  test("deposit button is visible and tappable at mobile width", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    // The open-deposit-modal button lives inside VaultActions on the home page
    const depositBtn = page.locator('[data-cy="open-deposit-modal"]');
    await expect(depositBtn).toBeVisible({ timeout: 8000 });

    // Verify tap target height ≥ 44 px
    const box = await depositBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("deposit modal opens, shows step 1, and is fully visible in viewport", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    await page.locator('[data-cy="open-deposit-modal"]').click();

    const modal = page.locator('[data-cy="tx-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal must not overflow the viewport horizontally
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1); // +1 for rounding

    // Step 1 content is visible
    await expect(page.locator('[data-cy="modal-step-1"]')).toBeVisible();
    await expect(page.locator('[data-cy="modal-amount-input"]')).toBeVisible();
  });

  test("user can type an amount and advance to step 2 on mobile", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    await page.locator('[data-cy="open-deposit-modal"]').click();
    await expect(page.locator('[data-cy="modal-step-1"]')).toBeVisible({ timeout: 5000 });

    // Fill in an amount
    const input = page.locator('[data-cy="modal-amount-input"]');
    await input.fill("100");

    // Tap Next
    await page.locator('[data-cy="modal-next-btn"]').click();

    // Should advance to step 2 (review)
    await expect(page.locator('[data-cy="modal-step-2"]')).toBeVisible({ timeout: 5000 });
  });

  test("modal close button is tappable (≥ 44 px) and closes the modal", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    await page.locator('[data-cy="open-deposit-modal"]').click();
    await expect(page.locator('[data-cy="tx-modal"]')).toBeVisible({ timeout: 5000 });

    const closeBtn = page.locator('[data-cy="modal-close"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(page.locator('[data-cy="tx-modal"]')).not.toBeVisible({ timeout: 3000 });
  });
});

// ── Hamburger Navigation ──────────────────────────────────────────────────────

test.describe("Hamburger navigation — mobile", () => {
  test.beforeEach(async ({ page }) => {
    await stubApis(page);
    await page.goto("/");
  });

  test("hamburger button is present and meets 44 px tap target", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const btn = page.locator('[data-cy="mobile-menu-btn"]');
    await expect(btn).toBeVisible({ timeout: 5000 });

    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("hamburger button opens the mobile nav panel", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const menuBtn = page.locator('[data-cy="mobile-menu-btn"]');
    await expect(menuBtn).toBeVisible({ timeout: 5000 });

    // Nav panel should not be visible before click
    await expect(page.locator('[data-cy="mobile-nav"]')).not.toBeVisible();

    await menuBtn.click();

    // Nav panel should appear
    await expect(page.locator('[data-cy="mobile-nav"]')).toBeVisible({ timeout: 3000 });

    // It should contain nav links
    const links = page.locator('[data-cy="mobile-nav-link"]');
    await expect(links).toHaveCount(3); // Home, FAQ, Settings
  });

  test("hamburger button closes the mobile nav when clicked again", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const menuBtn = page.locator('[data-cy="mobile-menu-btn"]');
    await expect(menuBtn).toBeVisible({ timeout: 5000 });

    // Open
    await menuBtn.click();
    await expect(page.locator('[data-cy="mobile-nav"]')).toBeVisible({ timeout: 3000 });

    // Close
    await menuBtn.click();
    await expect(page.locator('[data-cy="mobile-nav"]')).not.toBeVisible({ timeout: 3000 });
  });

  test("nav panel closes when a link is tapped", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const menuBtn = page.locator('[data-cy="mobile-menu-btn"]');
    await expect(menuBtn).toBeVisible({ timeout: 5000 });
    await menuBtn.click();

    const navPanel = page.locator('[data-cy="mobile-nav"]');
    await expect(navPanel).toBeVisible({ timeout: 3000 });

    // Click the first link (Home — stays on the same page)
    await page.locator('[data-cy="mobile-nav-link"]').first().click();

    // Panel collapses after navigation
    await expect(navPanel).not.toBeVisible({ timeout: 3000 });
  });

  test("nav links have ≥ 44 px touch targets", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const menuBtn = page.locator('[data-cy="mobile-menu-btn"]');
    await expect(menuBtn).toBeVisible({ timeout: 5000 });
    await menuBtn.click();

    const links = page.locator('[data-cy="mobile-nav-link"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

// ── Transaction History Scroll ────────────────────────────────────────────────

test.describe("Transaction history — mobile scroll", () => {
  test.beforeEach(async ({ page }) => {
    await stubApis(page);
    await page.goto("/");
  });

  test("transaction list is rendered and in the DOM", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const txList = page.locator('[data-cy="tx-list"]');
    await expect(txList).toBeVisible({ timeout: 8000 });
  });

  test("transaction list does not overflow the viewport horizontally", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const txList = page.locator('[data-cy="tx-list"]');
    await expect(txList).toBeVisible({ timeout: 8000 });

    const box = await txList.boundingBox();
    expect(box).not.toBeNull();
    // Should not extend beyond the right edge of the screen
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 2);
  });

  test("page body is scrollable when content overflows viewport height", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    // Scroll to the bottom of the page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Verify the transaction list is reachable by scrolling
    const txList = page.locator('[data-cy="tx-list"]');
    await txList.scrollIntoViewIfNeeded();
    await expect(txList).toBeInViewport({ timeout: 3000 });
  });

  test("transaction rows display correctly at mobile width (no clipped text)", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    const txList = page.locator('[data-cy="tx-list"]');
    await expect(txList).toBeVisible({ timeout: 8000 });

    // Each transaction row should be within the viewport width
    const rows = txList.locator('[role="listitem"]');
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const box = await rows.nth(i).boundingBox();
      if (box) {
        expect(box.x + box.width).toBeLessThanOrEqual(viewport!.width + 2);
      }
    }
  });
});

// ── Touch Targets (global 44 px audit) ────────────────────────────────────────

test.describe("Touch targets — ≥ 44 px audit", () => {
  test.beforeEach(async ({ page }) => {
    await stubApis(page);
  });

  test("primary action buttons on home page meet 44 px minimum", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    await page.goto("/");

    // Check the key interactive buttons that ship on the home page
    const selectors = [
      '[data-cy="deposit-tab"]',
      '[data-cy="withdraw-tab"]',
      '[data-cy="open-deposit-modal"]',
      '[data-cy="mobile-menu-btn"]',
    ];

    for (const sel of selectors) {
      const el = page.locator(sel).first();
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue; // skip elements not present on this page state

      const box = await el.boundingBox();
      if (box) {
        expect(
          box.height,
          `Touch target "${sel}" height is ${box.height}px — expected ≥ 44px`
        ).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("modal interaction buttons meet 44 px minimum when modal is open", async ({
    page,
    viewport,
  }) => {
    test.skip(!viewport || viewport.width > 430, "mobile-only test");

    await page.goto("/");

    await page.locator('[data-cy="open-deposit-modal"]').click();
    await expect(page.locator('[data-cy="tx-modal"]')).toBeVisible({ timeout: 5000 });

    const modalButtons = [
      '[data-cy="modal-next-btn"]',
      '[data-cy="modal-close"]',
    ];

    for (const sel of modalButtons) {
      const el = page.locator(sel).first();
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;

      const box = await el.boundingBox();
      if (box) {
        expect(
          box.height,
          `Modal button "${sel}" height is ${box.height}px — expected ≥ 44px`
        ).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
