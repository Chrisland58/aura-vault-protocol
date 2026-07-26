#!/usr/bin/env bash
# scripts/update-gas-baselines.sh
#
# Re-runs gas measurement tests and writes the current measurements back into
# gas-baselines.json.  Run this after an intentional optimisation or a new
# function is added.
#
# Usage:
#   ./scripts/update-gas-baselines.sh
#
# The existing threshold_percent and notes are preserved; only the
# cpu_instructions values are updated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BASELINE="${REPO_ROOT}/gas-baselines.json"
CARGO_DIR="${REPO_ROOT}/aura-vault"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RESET='\033[0m'

log()  { echo -e "${CYAN}[update-baselines]${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }

for cmd in cargo jq python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not found in PATH." >&2
        exit 1
    fi
done

log "Running gas measurement tests …"
RAW_OUTPUT=$(cd "${CARGO_DIR}" && \
    cargo test gas_ -- --nocapture 2>&1 || true)

declare -A MEASUREMENTS
while IFS= read -r line; do
    if [[ "$line" =~ ^GAS_MEASUREMENT:\ ([a-zA-Z_]+)\ ([0-9]+)$ ]]; then
        MEASUREMENTS["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        log "  ${BASH_REMATCH[1]} = ${BASH_REMATCH[2]}"
    fi
done <<< "$RAW_OUTPUT"

if [[ ${#MEASUREMENTS[@]} -eq 0 ]]; then
    echo "ERROR: No GAS_MEASUREMENT lines found in test output." >&2
    exit 1
fi

# Build updated JSON using python3 to reliably edit in place
MEASUREMENTS_JSON=$(python3 -c "
import json
m = {}
$(for fn in "${!MEASUREMENTS[@]}"; do
    echo "m['${fn}'] = ${MEASUREMENTS[$fn]}"
done)
print(json.dumps(m))
")

python3 - <<PYEOF
import json

with open('${BASELINE}') as f:
    data = json.load(f)

measurements = ${MEASUREMENTS_JSON}

for fn, val in measurements.items():
    if val == 0:
        continue  # keep sentinel as-is
    if fn in data['baselines']:
        old = data['baselines'][fn]['cpu_instructions']
        data['baselines'][fn]['cpu_instructions'] = val
        print(f"  Updated {fn}: {old} → {val}")
    else:
        data['baselines'][fn] = {'cpu_instructions': val, 'note': 'auto-generated'}
        print(f"  Added   {fn}: {val}")

with open('${BASELINE}', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print("Done.")
PYEOF

ok "Baselines updated in ${BASELINE}"
echo ""
echo "Review the diff, then commit:"
echo "  git diff gas-baselines.json"
echo "  git add gas-baselines.json && git commit -m 'chore: update gas baselines'"
