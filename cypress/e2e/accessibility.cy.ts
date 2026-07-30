/**
 * Accessibility E2E Tests — axe-core / WCAG 2.1 AA
 *
 * Runs axe-core on every page / route in the app and fails CI on any
 * Level A or Level AA violation that is not explicitly documented as a
 * known issue below.
 *
 * Known issues are listed in the KNOWN_ISSUES constant.  Each entry must
 * include:
 *   - id        : axe rule id (e.g. "color-contrast")
 *   - selector  : CSS selector of the offending element
 *   - issue     : brief description
 *   - ticket    : tracking issue URL
 *   - remediation: what needs to be done to fix it
 *
 * Update script: `npx cypress run --spec cypress/e2e/accessibility.cy.ts`
 */

/// <reference types="cypress" />
/// <reference types="cypress-axe" />

// ---------------------------------------------------------------------------
// Known / accepted violations — update this list as issues are resolved
// ---------------------------------------------------------------------------
interface KnownIssue {
  id: string;
  selector: string;
  issue: string;
  ticket: string;
  remediation: string;
}

const KNOWN_ISSUES: KnownIssue[] = [
  // Example (remove once fixed):
  // {
  //   id: "color-contrast",
  //   selector: ".badge-secondary",
  //   issue: "Badge text does not meet 4.5:1 contrast ratio in light mode",
  //   ticket: "https://github.com/soterika/aura-vault-protocol/issues/99",
  //   remediation: "Increase foreground colour to #595959 on white background",
  // },
];

// Derive the list of rule IDs that axe should allow (not fail on)
const KNOWN_ISSUE_RULE_IDS = [...new Set(KNOWN_ISSUES.map((k) => k.id))];

// ---------------------------------------------------------------------------
// axe run options — WCAG 2.1 Level A + AA only
// ---------------------------------------------------------------------------
const AXE_OPTIONS: Cypress.ConfigureAxeOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
  // Exclude known-issue rules from the live scan so CI does not red-light
  // them while the underlying fix is in progress.  They are still logged.
  rules: KNOWN_ISSUE_RULE_IDS.reduce(
    (acc, id) => ({ ...acc, [id]: { enabled: false } }),
    {} as Record<string, { enabled: boolean }>
  ),
};

// ---------------------------------------------------------------------------
// Violation reporter — prints element selector + fix guidance to Cypress log
// ---------------------------------------------------------------------------
function logViolations(violations: Cypress.Violation[]): void {
  violations.forEach((v) => {
    const nodes = v.nodes
      .map((n) => {
        const target = n.target.join(", ");
        const fix = n.failureSummary ?? "See axe documentation";
        return `  • Selector: ${target}\n    Fix: ${fix}`;
      })
      .join("\n");

    cy.log(
      `[axe] ${v.impact?.toUpperCase()} — ${v.id}: ${v.description}\n${nodes}\n  More info: ${v.helpUrl}`
    );

    Cypress.log({
      name: "axe violation",
      displayName: `♿ ${v.id}`,
      message: `${v.impact} — ${v.description}`,
      consoleProps: () => ({
        rule: v.id,
        impact: v.impact,
        description: v.description,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
          selector: n.target.join(", "),
          html: n.html,
          fix: n.failureSummary,
        })),
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: inject axe, run audit, assert zero violations, log any failures
// ---------------------------------------------------------------------------
function checkA11y(context?: string | Cypress.ElementContext): void {
  cy.injectAxe();
  cy.checkA11y(
    context,
    AXE_OPTIONS,
    logViolations,
    // Do NOT skip failures — violations must break CI
    false
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("Accessibility — WCAG 2.1 AA (axe-core)", () => {
  // Stub APIs so pages render meaningful content without a live backend
  beforeEach(() => {
    cy.interceptVaultApis();
  });

  // ── Home / Landing page ─────────────────────────────────────────────────
  describe("Home page", () => {
    beforeEach(() => {
      cy.visit("/");
    });

    it("has zero Level A/AA violations on load", () => {
      checkA11y();
    });

    it("has zero violations after wallet connected", () => {
      cy.connectWallet();
      checkA11y();
    });
  });

  // ── Dashboard ───────────────────────────────────────────────────────────
  describe("Dashboard page", () => {
    beforeEach(() => {
      cy.visit("/dashboard");
    });

    it("has zero violations on load", () => {
      checkA11y();
    });
  });

  // ── FAQ page ────────────────────────────────────────────────────────────
  describe("FAQ page", () => {
    beforeEach(() => {
      cy.visit("/faq");
    });

    it("has zero violations", () => {
      checkA11y();
    });
  });

  // ── Settings page ───────────────────────────────────────────────────────
  describe("Settings page", () => {
    beforeEach(() => {
      cy.visit("/settings");
    });

    it("has zero violations", () => {
      checkA11y();
    });
  });

  // ── Deposit form (interactive state) ────────────────────────────────────
  describe("Deposit form — interactive states", () => {
    beforeEach(() => {
      cy.visit("/");
      cy.connectWallet();
    });

    it("has zero violations with empty form", () => {
      cy.get("[data-cy=deposit-form]").should("be.visible");
      checkA11y("[data-cy=deposit-form]");
    });

    it("has zero violations when validation error is shown", () => {
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=deposit-error]").should("be.visible");
      checkA11y("[data-cy=deposit-form]");
    });

    it("has zero violations with valid amount entered", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      checkA11y("[data-cy=deposit-form]");
    });
  });

  // ── Withdraw form (interactive state) ───────────────────────────────────
  describe("Withdraw form — interactive states", () => {
    beforeEach(() => {
      cy.visit("/");
      cy.connectWallet();
    });

    it("has zero violations on withdraw form", () => {
      // Navigate to or open withdraw form
      cy.get("body").then(($body) => {
        if ($body.find("[data-cy=withdraw-tab]").length) {
          cy.get("[data-cy=withdraw-tab]").click();
        } else if ($body.find("[data-cy=withdraw-form]").length === 0) {
          // withdraw form may be on a separate route
          cy.visit("/");
        }
      });
      checkA11y();
    });
  });

  // ── Modal dialogs ────────────────────────────────────────────────────────
  describe("Transaction modal", () => {
    beforeEach(() => {
      cy.visit("/");
      cy.connectWallet();
    });

    it("has zero violations inside open modal", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      // Modal or pending state should appear
      cy.get("[data-cy=tx-pending],[data-cy=tx-modal],[data-cy=modal-step-1]", {
        timeout: 8000,
      }).should("exist");
      checkA11y();
    });
  });

  // ── Error states ─────────────────────────────────────────────────────────
  describe("Error / empty states", () => {
    it("has zero violations when API returns error", () => {
      cy.intercept("GET", "/api/vault/total_assets", {
        statusCode: 500,
        body: { error: "internal error" },
      });
      cy.visit("/");
      checkA11y();
    });
  });
});
