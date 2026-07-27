#!/usr/bin/env python3
"""
update_baselines.py — Update gas-baselines.json with freshly measured values.

Usage:
    python3 scripts/update_baselines.py \\
        --baselines gas-baselines.json \\
        --measurements gas-measurements.json
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path


def load_measurements(path: str) -> dict:
    """Parse NDJSON measurements; last entry per function wins."""
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Update gas baselines from measurements.")
    parser.add_argument("--baselines", default="gas-baselines.json")
    parser.add_argument("--measurements", default="gas-measurements.json")
    args = parser.parse_args()

    baselines_path = Path(args.baselines)
    if not baselines_path.exists():
        print(f"ERROR: {baselines_path} not found", file=sys.stderr)
        return 1

    measurements = load_measurements(args.measurements)
    if not measurements:
        print("ERROR: no measurements found", file=sys.stderr)
        return 1

    data = json.loads(baselines_path.read_text())
    existing = data.get("baselines", {})

    updated = 0
    added = 0
    for fn_name, values in measurements.items():
        if fn_name in existing:
            existing[fn_name] = values
            updated += 1
        else:
            existing[fn_name] = values
            added += 1
            print(f"  + Added new function: {fn_name}")

    data["baselines"] = existing
    data["_updated"] = str(date.today())

    baselines_path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Updated {updated} existing + {added} new baselines in {baselines_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
