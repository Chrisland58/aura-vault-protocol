#!/usr/bin/env bash
# update-gas-baselines.sh
#
# Run the gas measurement tests, then update gas-baselines.json with the
# freshly measured values.
#
# Usage:
#   cd <repo-root>
#   bash scripts/update-gas-baselines.sh
#
# After running, commit the updated gas-baselines.json.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINES_FILE="${REPO_ROOT}/gas-baselines.json"
MEASUREMENTS_FILE="${REPO_ROOT}/gas-measurements.json"

echo "==> Cleaning previous measurements..."
rm -f "${MEASUREMENTS_FILE}"

echo "==> Running gas measurement tests..."
cd "${REPO_ROOT}/aura-vault"
GAS_OUTPUT="${MEASUREMENTS_FILE}" \
  cargo test gas_ --test-threads=1 -- --nocapture 2>/dev/null

if [ ! -f "${MEASUREMENTS_FILE}" ]; then
  echo "ERROR: ${MEASUREMENTS_FILE} was not created. Did the gas tests run?" >&2
  exit 1
fi

echo "==> Updating baselines from measurements..."
python3 "${REPO_ROOT}/scripts/update_baselines.py" \
  --baselines "${BASELINES_FILE}" \
  --measurements "${MEASUREMENTS_FILE}"

echo "==> Done. Review and commit ${BASELINES_FILE}"
