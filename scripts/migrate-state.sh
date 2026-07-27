#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/migrate-state.sh
#
# Migrates existing local Terraform state files into the S3 remote backend.
# Run AFTER `terraform -chdir=terraform/remote-state apply` completes.
#
# Usage:
#   ./scripts/migrate-state.sh [--dry-run]
#
# Requirements:
#   - AWS CLI configured (or OIDC session active in CI)
#   - terraform >= 1.6 on PATH
#   - jq on PATH
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[dry-run] No changes will be made."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REMOTE_STATE_DIR="${REPO_ROOT}/terraform/remote-state"

# ── 1. Resolve outputs from the remote-state module ──────────────────────────
echo "==> Fetching outputs from terraform/remote-state …"
BUCKET=$(terraform -chdir="${REMOTE_STATE_DIR}" output -raw state_bucket_name)
REGION=$(terraform -chdir="${REMOTE_STATE_DIR}" output -raw aws_region 2>/dev/null || echo "us-east-1")
TABLE=$(terraform -chdir="${REMOTE_STATE_DIR}" output -raw lock_table_name)

echo "    Bucket : ${BUCKET}"
echo "    Region : ${REGION}"
echo "    Table  : ${TABLE}"
echo ""

# ── 2. Find all module directories that contain a local terraform.tfstate ────
mapfile -t LOCAL_STATE_FILES < <(find "${REPO_ROOT}/terraform" -name "terraform.tfstate" -not -path "*/remote-state/*" 2>/dev/null || true)

if [[ ${#LOCAL_STATE_FILES[@]} -eq 0 ]]; then
  echo "No local terraform.tfstate files found. Nothing to migrate."
  exit 0
fi

echo "Found ${#LOCAL_STATE_FILES[@]} local state file(s) to migrate:"
for f in "${LOCAL_STATE_FILES[@]}"; do
  echo "  - ${f}"
done
echo ""

# ── 3. Migrate each module ────────────────────────────────────────────────────
for STATE_FILE in "${LOCAL_STATE_FILES[@]}"; do
  MODULE_DIR="$(dirname "${STATE_FILE}")"
  # Derive S3 key from path relative to terraform/
  REL_PATH="${MODULE_DIR#${REPO_ROOT}/terraform/}"
  S3_KEY="${REL_PATH}/terraform.tfstate"

  echo "─── Migrating: ${MODULE_DIR}"
  echo "    S3 key  : s3://${BUCKET}/${S3_KEY}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "    [dry-run] Would run: terraform -chdir=${MODULE_DIR} init -migrate-state"
    continue
  fi

  # Write a temporary backend config file for this module
  BACKEND_CFG=$(mktemp /tmp/backend-XXXXXX.tfvars)
  cat > "${BACKEND_CFG}" <<EOF
bucket         = "${BUCKET}"
key            = "${S3_KEY}"
region         = "${REGION}"
dynamodb_table = "${TABLE}"
encrypt        = true
EOF

  # Ensure backend "s3" block exists in the module (idempotent upsert)
  if ! grep -q 'backend "s3"' "${MODULE_DIR}/terraform.tf" 2>/dev/null && \
     ! grep -q 'backend "s3"' "${MODULE_DIR}/backend.tf" 2>/dev/null; then
    echo "    Adding backend.tf to ${MODULE_DIR}"
    cp "${REPO_ROOT}/terraform/backend.tf" "${MODULE_DIR}/backend.tf"
    # Replace the key placeholder
    sed -i "s|REPLACE_WITH_MODULE_PATH|${REL_PATH}|g" "${MODULE_DIR}/backend.tf"
    # Set actual bucket name
    sed -i "s|bucket         = \"\"|bucket         = \"${BUCKET}\"|g" "${MODULE_DIR}/backend.tf"
  fi

  # Migrate state
  terraform -chdir="${MODULE_DIR}" init \
    -backend-config="${BACKEND_CFG}" \
    -migrate-state \
    -force-copy \
    -input=false

  rm -f "${BACKEND_CFG}"

  # Verify state is accessible remotely
  echo "    Verifying remote state …"
  terraform -chdir="${MODULE_DIR}" state list > /dev/null && echo "    ✓ Remote state OK"
  echo ""
done

echo "==> Migration complete."
echo ""
echo "Next steps:"
echo "  1. Verify 'terraform plan' shows no changes for each module."
echo "  2. Delete local terraform.tfstate files (they are now in S3)."
echo "  3. Add *.tfstate and *.tfstate.backup to .gitignore if not already present."
