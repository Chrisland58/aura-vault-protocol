#!/usr/bin/env python3
"""
compare_gas.py — Compare measured gas (CPU instructions) against baselines.

Reads:
  - gas-baselines.json       : baseline measurements with threshold
  - gas-measurements.json    : current measurements (NDJSON, one JSON obj / line)

Outputs:
  - A Markdown gas report to stdout (captured as GAS_REPORT env var in CI)
  - Exit code 0 if all functions are within threshold, else 1

Usage:
    python3 scripts/compare_gas.py \\
        --baselines gas-baselines.json \\
        --measurements gas-measurements.json \\
        [--threshold 10]
"""

import argparse
import json
import sys
from pathlib import Path


THRESHOLD_DEFAULT = 10  # percent


def load_baselines(path: str) -> tuple[dict, int]:
    """Return (baselines_dict, threshold_pct)."""
    data = json.loads(Path(path).read_text())
    threshold = data.get("_threshold_pct", THRESHOLD_DEFAULT)
    return data["baselines"], int(threshold)


def load_measurements(path: str) -> dict:
    """Parse NDJSON measurements file; last entry for each function wins."""
    measurements: dict = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            fn_name = obj["function"]
            measurements[fn_name] = {
                "cpu_instructions": int(obj["cpu_instructions"]),
                "memory_bytes": int(obj["memory_bytes"]),
            }
        except (json.JSONDecodeError, KeyError) as exc:
            print(f"WARNING: skipping malformed line: {line!r} ({exc})", file=sys.stderr)
    return measurements


def pct_change(baseline: int, current: int) -> float:
    """Signed percentage change from baseline to current."""
    if baseline == 0:
        return 0.0
    return (current - baseline) / baseline * 100.0


def emoji(change: float, threshold: float) -> str:
    if change > threshold:
        return "🔴"
    if change > threshold / 2:
        return "🟡"
    if change < -1.0:
        return "🟢"
    return "✅"


def build_report(
    baselines: dict,
    measurements: dict,
    threshold_pct: int,
) -> tuple[str, bool]:
    """Return (markdown_report, passed)."""
    lines: list[str] = []
    failures: list[str] = []

    lines.append("## ⛽ Gas Usage Report\n")
    lines.append(
        f"Threshold: **+{threshold_pct}%** above baseline triggers failure.\n"
    )
    lines.append(
        "| Function | Baseline (CPU insns) | Current (CPU insns) | Δ% | Status |"
    )
    lines.append("|---|---:|---:|---:|:---:|")

    all_functions = sorted(set(list(baselines.keys()) + list(measurements.keys())))

    for fn in all_functions:
        baseline_entry = baselines.get(fn)
        measured_entry = measurements.get(fn)

        if baseline_entry is None:
            # New function — no baseline yet
            cpu_current = measured_entry["cpu_instructions"] if measured_entry else 0
            lines.append(
                f"| `{fn}` | _(new)_ | {cpu_current:,} | — | 🆕 |"
            )
            continue

        if measured_entry is None:
            # Function exists in baseline but was not measured — warn
            lines.append(
                f"| `{fn}` | {baseline_entry['cpu_instructions']:,} | _(not measured)_ | — | ⚠️ |"
            )
            continue

        baseline_cpu = baseline_entry["cpu_instructions"]
        current_cpu = measured_entry["cpu_instructions"]
        delta = pct_change(baseline_cpu, current_cpu)
        icon = emoji(delta, threshold_pct)

        delta_str = f"{delta:+.1f}%"
        lines.append(
            f"| `{fn}` | {baseline_cpu:,} | {current_cpu:,} | {delta_str} | {icon} |"
        )

        if delta > threshold_pct:
            failures.append(
                f"  • `{fn}`: {current_cpu:,} insns (+{delta:.1f}% > {threshold_pct}% threshold)"
            )

    passed = len(failures) == 0

    if failures:
        lines.append("\n### ❌ Regressions detected\n")
        lines.extend(failures)
    else:
        lines.append("\n### ✅ All functions within gas threshold\n")

    lines.append(
        "\n> _CPU instruction counts measured in soroban-sdk native test mode._"
        "\n> _Counts are lower than on-chain WASM but consistent across runs._"
    )

    return "\n".join(lines), passed


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare gas measurements to baselines.")
    parser.add_argument(
        "--baselines",
        default="gas-baselines.json",
        help="Path to gas-baselines.json",
    )
    parser.add_argument(
        "--measurements",
        default="gas-measurements.json",
        help="Path to NDJSON gas measurements file",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=None,
        help="Override threshold percentage (default: read from baselines file)",
    )
    args = parser.parse_args()

    # Load files
    if not Path(args.baselines).exists():
        print(f"ERROR: baselines file not found: {args.baselines}", file=sys.stderr)
        return 1
    if not Path(args.measurements).exists():
        print(f"ERROR: measurements file not found: {args.measurements}", file=sys.stderr)
        return 1

    baselines, threshold_pct = load_baselines(args.baselines)
    if args.threshold is not None:
        threshold_pct = args.threshold

    measurements = load_measurements(args.measurements)

    if not measurements:
        print("ERROR: no measurements found in measurements file", file=sys.stderr)
        return 1

    report, passed = build_report(baselines, measurements, threshold_pct)

    # Always print report to stdout so CI can capture it.
    print(report)

    if not passed:
        print(
            "\nFAILURE: One or more contract functions exceed the gas regression threshold.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
