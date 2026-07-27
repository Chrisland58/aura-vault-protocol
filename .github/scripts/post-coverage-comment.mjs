#!/usr/bin/env node
/**
 * post-coverage-comment.mjs
 *
 * Reads coverage JSON summaries produced by each component's test run and
 * posts (or updates) a single PR comment with a per-component coverage table
 * and a delta column showing how coverage changed from the base branch.
 *
 * Environment variables required when running in CI:
 *   GITHUB_TOKEN        – token with `pull-requests: write` permission
 *   GITHUB_REPOSITORY   – owner/repo  (set automatically by Actions)
 *   PR_NUMBER           – pull request number  (set in CI YAML)
 *
 * Expected artifact layout (produced by each coverage job):
 *   coverage/smart-contract/tarpaulin-report.json   (Tarpaulin JSON)
 *   coverage/backend/coverage-summary.json           (Vitest/c8 JSON summary)
 *   coverage/frontend/coverage-summary.json          (Vitest JSON summary)
 *
 * Base-branch summaries (optional, downloaded from the last successful run):
 *   coverage/base/smart-contract/tarpaulin-report.json
 *   coverage/base/backend/coverage-summary.json
 *   coverage/base/frontend/coverage-summary.json
 *
 * If a base file is missing the delta column shows "N/A".
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ─── helpers ────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Round a float to one decimal place and append %. */
function pct(value) {
  if (value == null || isNaN(value)) return "—";
  return `${Number(value).toFixed(1)} %`;
}

/** Format a delta value with a +/- prefix and colour emoji. */
function delta(current, base) {
  if (base == null || current == null) return "N/A";
  const diff = (current - base).toFixed(1);
  if (diff > 0) return `+${diff} % ✅`;
  if (diff < 0) return `${diff} % ❌`;
  return `±0.0 %`;
}

// ─── parsers ────────────────────────────────────────────────────────────────

/**
 * Parse a Tarpaulin JSON report.
 * Returns { line: number (0-100) } or null.
 */
function parseTarpaulin(json) {
  if (!json) return null;
  // Tarpaulin v0.27+ emits { "line_rate": 0.NN, ... } at the top level
  if (typeof json.line_rate === "number") {
    return { line: json.line_rate * 100 };
  }
  // Older format: array of file objects — compute aggregate
  if (Array.isArray(json)) {
    let covered = 0;
    let total = 0;
    for (const file of json) {
      if (Array.isArray(file.traces)) {
        total += file.traces.length;
        covered += file.traces.filter((t) => t.stats?.Line > 0).length;
      }
    }
    return total > 0 ? { line: (covered / total) * 100 } : null;
  }
  return null;
}

/**
 * Parse a Vitest/c8 coverage-summary.json.
 * Returns { lines, branches, functions, statements } (each 0-100) or null.
 */
function parseVitestSummary(json) {
  if (!json || !json.total) return null;
  const t = json.total;
  return {
    lines: t.lines?.pct ?? null,
    branches: t.branches?.pct ?? null,
    functions: t.functions?.pct ?? null,
    statements: t.statements?.pct ?? null,
  };
}

/**
 * Parse per-file data from a Vitest/c8 coverage-summary.json for the
 * "changed files" table.  Returns an array of { file, lines, branches } rows.
 */
function parseVitestFiles(json, repoRoot, component) {
  if (!json) return [];
  return Object.entries(json)
    .filter(([key]) => key !== "total")
    .map(([absPath, data]) => {
      const relPath = absPath.startsWith(repoRoot)
        ? absPath.slice(repoRoot.length + 1)
        : absPath;
      return {
        file: relPath,
        lines: data.lines?.pct ?? null,
        branches: data.branches?.pct ?? null,
        component,
      };
    })
    .sort((a, b) => (a.file > b.file ? 1 : -1));
}

// ─── build comment body ──────────────────────────────────────────────────────

function buildComment(current, base) {
  const rows = [];

  // Smart contract
  const sc = current.smartContract;
  const scBase = base.smartContract;
  rows.push({
    component: "Smart Contract",
    metric: "Line",
    value: sc ? pct(sc.line) : "—",
    threshold: "≥ 90 %",
    delta: delta(sc?.line, scBase?.line),
    status: sc ? (sc.line >= 90 ? "✅" : "❌") : "⚠️",
  });

  // Backend
  const be = current.backend;
  const beBase = base.backend;
  rows.push({
    component: "Backend",
    metric: "Branch",
    value: be ? pct(be.branches) : "—",
    threshold: "≥ 80 %",
    delta: delta(be?.branches, beBase?.branches),
    status: be ? (be.branches >= 80 ? "✅" : "❌") : "⚠️",
  });

  // Frontend
  const fe = current.frontend;
  const feBase = base.frontend;
  rows.push({
    component: "Frontend",
    metric: "Line",
    value: fe ? pct(fe.lines) : "—",
    threshold: "≥ 75 %",
    delta: delta(fe?.lines, feBase?.lines),
    status: fe ? (fe.lines >= 75 ? "✅" : "❌") : "⚠️",
  });

  const overallPass = rows.every((r) => r.status === "✅");
  const header = overallPass
    ? "## 📊 Coverage Report — All thresholds met ✅"
    : "## 📊 Coverage Report — Threshold violation detected ❌";

  const table = [
    "| Component | Metric | Coverage | Threshold | Δ from base | Status |",
    "|-----------|--------|----------|-----------|-------------|--------|",
    ...rows.map(
      (r) =>
        `| ${r.component} | ${r.metric} | ${r.value} | ${r.threshold} | ${r.delta} | ${r.status} |`
    ),
  ].join("\n");

  // Per-file changed files section (backend + frontend only)
  const fileRows = [
    ...parseVitestFiles(current.backendRaw, ROOT, "Backend"),
    ...parseVitestFiles(current.frontendRaw, ROOT, "Frontend"),
  ];

  let filesSection = "";
  if (fileRows.length > 0) {
    const fileTable = [
      "<details>",
      "<summary>📂 Per-file coverage details (backend + frontend)</summary>",
      "",
      "| Component | File | Line % | Branch % |",
      "|-----------|------|--------|----------|",
      ...fileRows.map(
        (r) => `| ${r.component} | \`${r.file}\` | ${pct(r.lines)} | ${pct(r.branches)} |`
      ),
      "",
      "</details>",
    ].join("\n");
    filesSection = `\n\n${fileTable}`;
  }

  const footer = [
    "",
    "---",
    "_Thresholds are configured in:_",
    "- `aura-vault/tarpaulin.toml` (smart contract — `fail-under`)",
    "- `backend/vitest.config.ts` (backend — `thresholds`)",
    "- `frontend/vitest.config.ts` (frontend — `thresholds`)",
    "",
    `_Generated by [post-coverage-comment](.github/scripts/post-coverage-comment.mjs) · ${new Date().toUTCString()}_`,
  ].join("\n");

  return `<!-- aura-coverage-report -->\n${header}\n\n${table}${filesSection}${footer}`;
}

// ─── GitHub API helpers ──────────────────────────────────────────────────────

async function apiRequest(method, url, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${url} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function upsertComment(owner, repo, prNumber, body) {
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const comments = await apiRequest("GET", listUrl);

  const existing = comments.find(
    (c) =>
      c.user?.type === "Bot" && c.body?.includes("<!-- aura-coverage-report -->")
  );

  if (existing) {
    await apiRequest("PATCH", existing.url, { body });
    console.log(`Updated existing coverage comment #${existing.id}`);
  } else {
    await apiRequest("POST", listUrl, { body });
    console.log("Posted new coverage comment");
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const coverageDir = path.join(ROOT, "coverage");
  const baseCoverageDir = path.join(coverageDir, "base");

  // Read current coverage reports
  const scJson = readJson(path.join(coverageDir, "smart-contract", "tarpaulin-report.json"));
  const beJson = readJson(path.join(coverageDir, "backend", "coverage-summary.json"));
  const feJson = readJson(path.join(coverageDir, "frontend", "coverage-summary.json"));

  // Read base-branch coverage reports (may not exist on first run)
  const scBaseJson = readJson(path.join(baseCoverageDir, "smart-contract", "tarpaulin-report.json"));
  const beBaseJson = readJson(path.join(baseCoverageDir, "backend", "coverage-summary.json"));
  const feBaseJson = readJson(path.join(baseCoverageDir, "frontend", "coverage-summary.json"));

  const current = {
    smartContract: parseTarpaulin(scJson),
    backend: parseVitestSummary(beJson),
    frontend: parseVitestSummary(feJson),
    backendRaw: beJson,
    frontendRaw: feJson,
  };

  const base = {
    smartContract: parseTarpaulin(scBaseJson),
    backend: parseVitestSummary(beBaseJson),
    frontend: parseVitestSummary(feBaseJson),
  };

  const commentBody = buildComment(current, base);

  // Write the comment body to a file so it can be uploaded as an artifact
  // even when not running in a PR context.
  const outPath = path.join(coverageDir, "coverage-comment.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, commentBody, "utf8");
  console.log(`Coverage comment written to ${outPath}`);
  console.log("\n--- Preview ---\n");
  console.log(commentBody);

  // Post to GitHub only when running in a PR
  const prNumber = process.env.PR_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;
  if (prNumber && repo) {
    const [owner, repoName] = repo.split("/");
    await upsertComment(owner, repoName, prNumber, commentBody);
  } else {
    console.log("\nNot a PR context — skipping GitHub comment (set PR_NUMBER and GITHUB_REPOSITORY to enable).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
