#!/usr/bin/env bash
# scripts/check-gas.sh
#
# Runs the AuraVault gas measurement tests, parses their output, and compares
# each function's CPU instruction count against the baseline in
# gas-baselines.json.
#
# Exit codes:
#   0  — all functions within threshold
#   1  — one or more functions exceeded the allowed threshold
#
# Usage:
#   ./scripts/check-gas.sh
#
# Environment variables:
#   GAS_BASELINE  — path to the baseline file   (default: ./gas-baselines.json)
#   GAS_REPORT    — path to write the JSON report (default: ./gas-report.json)
#   CARGO_DIR     — directory with Cargo.toml     (default: ./aura-vault)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BASELINE="${GAS_BASELINE:-${REPO_ROOT}/gas-baselines.json}"
REPORT="${GAS_REPORT:-${REPO_ROOT}/gas-report.json}"
CARGO_DIR="${CARGO_DIR:-${REPO_ROOT}/aura-vault}"
MEASUREMENTS_FILE="$(mktemp)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${CYAN}[gas-check]${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; }

cleanup() { rm -f "${MEASUREMENTS_FILE}"; }
trap cleanup EXIT

# ── Dependency checks ──────────────────────────────────────────────────────────
for cmd in cargo jq python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not found in PATH." >&2
        exit 1
    fi
done

# ── Run gas tests ──────────────────────────────────────────────────────────────
log "Running gas measurement tests in ${CARGO_DIR} …"
RAW_OUTPUT=$(cd "${CARGO_DIR}" && \
    cargo test gas_ -- --nocapture 2>&1 || true)

# ── Parse GAS_MEASUREMENT lines ───────────────────────────────────────────────
# Expected format:  GAS_MEASUREMENT: <function_name> <integer_instructions>
while IFS= read -r line; do
    if [[ "$line" =~ ^GAS_MEASUREMENT:\ ([a-zA-Z_]+)\ ([0-9]+)$ ]]; then
        echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}" >> "${MEASUREMENTS_FILE}"
        log "  Measured: ${BASH_REMATCH[1]} = ${BASH_REMATCH[2]} instructions"
    fi
done <<< "$RAW_OUTPUT"

if [[ ! -s "${MEASUREMENTS_FILE}" ]]; then
    echo "ERROR: No GAS_MEASUREMENT lines found in test output." >&2
    echo "Raw output:" >&2
    echo "$RAW_OUTPUT" >&2
    exit 1
fi

# ── Compare against baselines (pure Python) ────────────────────────────────────
python3 - "${BASELINE}" "${MEASUREMENTS_FILE}" "${REPORT}" <<'PYEOF'
import json
import sys
import os

baseline_path  = sys.argv[1]
measurements_path = sys.argv[2]
report_path    = sys.argv[3]

# ANSI colours
RED    = "\033[0;31m"
GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

with open(baseline_path) as f:
    baseline_data = json.load(f)

threshold = float(baseline_data["threshold_percent"])
baselines = baseline_data["baselines"]

# Load measurements
measurements = {}
with open(measurements_path) as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) == 2:
            measurements[parts[0]] = int(parts[1])

# Print table header
print(f"{BOLD}{'Function':<20} {'Baseline':>15} {'Current':>15} {'Delta%':>10} {'Status':>10}{RESET}")
print("─" * 75)

results = []
total_pass = 0
total_fail = 0
total_skip = 0

for fn in sorted(baselines.keys()):
    bl = baselines[fn]["cpu_instructions"]
    current = measurements.get(fn)

    # Sentinel (baseline=0) or unmeasured → skip
    if bl == 0 or current is None:
        current_disp = str(current) if current is not None else "NOT_MEASURED"
        print(f"{fn:<20} {bl:>15,} {current_disp:>15} {'—':>10} {'SKIP':>10}")
        total_skip += 1
        results.append({"function": fn, "baseline": bl, "current": current_disp,
                         "delta_percent": None, "status": "skip"})
        continue

    if bl == 0:
        delta = 0.0
    else:
        delta = ((current - bl) / bl) * 100.0

    if delta > threshold:
        status = "fail"
        total_fail += 1
        status_disp = f"{RED}FAIL{RESET}"
    else:
        status = "pass"
        total_pass += 1
        if delta > 0:
            status_disp = f"{YELLOW}PASS↑{RESET}"
        elif delta < 0:
            status_disp = f"{GREEN}improved{RESET}"
        else:
            status_disp = f"{GREEN}PASS{RESET}"

    sign = "+" if delta >= 0 else ""
    print(f"{fn:<20} {bl:>15,} {current:>15,} {sign}{delta:>9.2f}% {status_disp}")
    results.append({"function": fn, "baseline": bl, "current": current,
                     "delta_percent": round(delta, 2), "status": status})

print("─" * 75)
print(f"{BOLD}Summary: {GREEN}{total_pass} passed{RESET}, "
      f"{RED}{total_fail} failed{RESET}, "
      f"{YELLOW}{total_skip} skipped{RESET}\n")

# Write JSON report
report = {
    "pass": total_pass,
    "fail": total_fail,
    "skip": total_skip,
    "threshold_percent": threshold,
    "results": results,
}
with open(report_path, "w") as f:
    json.dump(report, f, indent=2)
    f.write("\n")
print(f"Report written to {report_path}")

sys.exit(1 if total_fail > 0 else 0)
PYEOF

EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    fail "Gas regression threshold exceeded. See ${REPORT} for details."
    echo ""
    echo "To update baselines after an intentional optimisation:"
    echo "  ./scripts/update-gas-baselines.sh"
    exit 1
else
    ok "All gas measurements within threshold."
    exit 0
fi
