/**
 * Accessibility E2E Tests — @axe-core/playwright / WCAG 2.1 AA
 *
 * Runs axe-core on every page in the Playwright suite.  Any Level A or
 * Level AA violation that is not listed in KNOWN_ISSUES will fail CI.
 *
 * Known issues document the element selector, fix guidance, and a
 * tracking ticket so the team has a clear remediation path.
 *
 * Usage:
 *   npx playwright test playwright/accessibility.spec.ts
 */

import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ---------------------------------------------------------------------------
// Axe options — WCAG 2.1 A + AA only
// ---------------------------------------------------------------------------
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// ---------------------------------------------------------------------------
// Known / accepted violations
// Remove entries once the underlying issue is fixed.
// ---------------------------------------------------------------------------
interface KnownIssue {
  ruleId: string;
  selector: string;
  issue: string;
  ticket: string;
  remediation: string;
}

const KNOWN_ISSUES: KnownIssue[] = [
  // Example — remove once fixed:
  // {
  //   ruleId: "color-contrast",
  //   selector: ".badge-secondary",
  //   issue: "Insufficient contrast on secondary badge in light theme",
  //   ticket: "https://github.com/soterika/aura-vault-protocol/issues/99",
  //   remediation: "Darken text to #595959 on white (#ffffff) background",
  // },
];

const KNOWN_RULE_IDS = new Set(KNOWN_ISSUES.map((k) => k.ruleId));

// ---------------------------------------------------------------------------
// Helper: run axe, filter known issues, assert zero remaining violations.
// Logs each violation with selector + fix guidance to the test reporter.
// ---------------------------------------------------------------------------
async function checkA11y(
  page: Page,
  context?: string,
  description = "page"
): Promise<void> {
  const builder = new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // Disable known-issue rules while tracking tickets are open
    .disableRules([...KNOWN_RULE_IDS]);

  if (context) {
    builder.include(context);
  }

  const results = await builder.analyze();

  // Log violations with actionable details even when assertions pass
  if (results.violations.length > 0) {
    console.error(
      `\n[axe] ${results.violations.length} violation(s) on ${description}:`
    );
    results.violations.forEach((v) => {
      console.error(`\n  Rule: ${v.id} [${v.impact}]`);
      console.error(`  Desc: ${v.description}`);
      console.error(`  Help: ${v.helpUrl}`);
      v.nodes.forEach((n) => {
        const selector = n.target.join(" > ");
        console.error(`  ↳ Selector: ${selector}`);
        console.error(`    HTML:     ${n.html.slice(0, 120)}`);
        if (n.failureSummary) {
          console.error(`    Fix:      ${n.failureSummary}`);
        }
      });
    });
  }

  expect(
    results.violations,
    `axe WCAG 2.1 AA violations on ${description}:\n` +
      results.violations
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.description} — ${v.helpUrl}\n` +
            v.nodes
              .map((n) => `    • ${n.target.join(" > ")}`)
              .join("\n")
        )
        .join("\n")
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Mock API helper — intercept vault API calls so pages render correctly
// without a running backend.
// ---------------------------------------------------------------------------
async function mockVaultApis(page: Page): Promise<void> {
  await page.route("**/api/vault/total_assets", (route) =>
    route.fulfill({ json: { total: "500000" } })
  );
  await page.route("**/api/vault/balance_of**", (route) =>
    route.fulfill({ json: { balance: "1000" } })
  );
  await page.route("**/api/vault/deposit", (route) =>
    route.fulfill({ json: { result: "ok", txHash: "abc123" } })
  );
  await page.route("**/api/vault/withdraw", (route) =>
    route.fulfill({ json: { result: "ok", txHash: "def456" } })
  );
  await page.route("**/api/yield/**", (route) =>
    route.fulfill({ json: { apy: "10.5", totalDeposited: "500000" } })
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Accessibility — WCAG 2.1 AA (@axe-core/playwright)", () => {
  test.beforeEach(async ({ page }) => {
    await mockVaultApis(page);
  });

  // ── Home / Landing page ─────────────────────────────────────────────────
  test.describe("Home page", () => {
    test("has zero Level A/AA violations on load", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await checkA11y(page, undefined, "home page");
    });

    test("has zero violations after wallet mock injected", async ({ page }) => {
      await page.goto("/");
      // Inject a minimal freighterApi mock
      await page.evaluate(() => {
        (window as any).freighterApi = {
          isConnected: () => Promise.resolve(true),
          getPublicKey: () => Promise.resolve("GABC1234TESTPUBLICKEY"),
          getNetwork: () => Promise.resolve("TESTNET"),
          signTransaction: () => Promise.resolve("signed_xdr"),
        };
      });
      await page.waitForLoadState("networkidle");
      await checkA11y(page, undefined, "home page with wallet mock");
    });
  });

  // ── Dashboard ────────────────────────────────────────────────────────────
  test.describe("Dashboard page", () => {
    test("has zero violations on load", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await checkA11y(page, undefined, "dashboard page");
    });
  });

  // ── FAQ page ─────────────────────────────────────────────────────────────
  test.describe("FAQ page", () => {
    test("has zero violations", async ({ page }) => {
      await page.goto("/faq");
      await page.waitForLoadState("networkidle");
      await checkA11y(page, undefined, "faq page");
    });
  });

  // ── Settings page ────────────────────────────────────────────────────────
  test.describe("Settings page", () => {
    test("has zero violations", async ({ page }) => {
      await page.goto("/settings");
      await page.waitForLoadState("networkidle");
      await checkA11y(page, undefined, "settings page");
    });
  });

  // ── Deposit form — interactive states ────────────────────────────────────
  test.describe("Deposit form — interactive states", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
    });

    test("has zero violations with empty deposit form", async ({ page }) => {
      const form = page.getByTestId("deposit-form");
      if (await form.isVisible()) {
        await checkA11y(page, "[data-cy=deposit-form]", "deposit form empty");
      } else {
        await checkA11y(page, undefined, "home page (no deposit form visible)");
      }
    });

    test("has zero violations with validation error shown", async ({
      page,
    }) => {
      const submitBtn = page.getByTestId("deposit-submit");
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForSelector("[data-cy=deposit-error]", {
          timeout: 5000,
        }).catch(() => {/* error may not appear if form is not present */});
      }
      await checkA11y(page, undefined, "deposit form with validation error");
    });
  });

  // ── Error states ─────────────────────────────────────────────────────────
  test.describe("Error / degraded states", () => {
    test("has zero violations when API returns 500", async ({ page }) => {
      await page.route("**/api/vault/total_assets", (route) =>
        route.fulfill({ status: 500, json: { error: "internal error" } })
      );
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await checkA11y(page, undefined, "home page with API error");
    });
  });

  // ── All routes scan ──────────────────────────────────────────────────────
  // Iterates a predefined route list to ensure every route is covered.
  test.describe("All routes — comprehensive scan", () => {
    const ROUTES = ["/", "/dashboard", "/faq", "/settings"];

    for (const route of ROUTES) {
      test(`${route} — zero WCAG 2.1 AA violations`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await checkA11y(page, undefined, `route ${route}`);
      });
    }
  });
});
