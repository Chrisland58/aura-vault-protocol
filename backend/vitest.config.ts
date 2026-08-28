import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the Aura Vault backend.
 *
 * Coverage thresholds live here — edit this file to change them.
 * No CI YAML changes are needed; the CI step runs `vitest run --coverage`
 * and vitest will exit non-zero when any threshold is violated.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    coverage: {
      // Use the c8/Istanbul provider (V8 native instrumentation)
      provider: "v8",

      // Output formats: JSON summary for the PR delta script, lcov for tooling
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../coverage/backend",

      // Source files to measure (exclude entry point barrel and test helpers)
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",   // Express bootstrap — covered by integration tests
        "**/*.test.ts",
        "**/*.spec.ts",
      ],

      /**
       * Thresholds enforced by vitest — build fails if any metric falls below.
       * The acceptance criterion is ≥ 80 % branch coverage.
       * Lines, functions, and statements are set conservatively to avoid noise.
       *
       * To relax or tighten a threshold, edit only this block.
       */
      thresholds: {
        branches: 80,
        lines: 75,
        functions: 75,
        statements: 75,
      },
    },
  },
});
