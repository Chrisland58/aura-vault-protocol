import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vitest configuration for the Aura Vault frontend (Next.js / React).
 *
 * Coverage thresholds live here — edit this file to change them.
 * No CI YAML changes are needed; the CI step runs `vitest run --coverage`
 * and vitest will exit non-zero when any threshold is violated.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    // jsdom gives us a browser-like DOM for React component tests
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    coverage: {
      provider: "v8",

      // Output formats: JSON summary for the PR delta script, lcov for tooling
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../coverage/frontend",

      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/test/**",
        // Next.js generated / boilerplate
        "src/app/layout.tsx",
        "src/app/globals.css",
      ],

      /**
       * Thresholds enforced by vitest — build fails if any metric falls below.
       * The acceptance criterion is ≥ 75 % line coverage.
       *
       * To relax or tighten a threshold, edit only this block.
       */
      thresholds: {
        lines: 75,
        branches: 70,
        functions: 70,
        statements: 75,
      },
    },
  },
});
