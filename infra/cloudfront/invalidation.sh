#!/usr/bin/env bash
# invalidation.sh — Trigger a CloudFront cache invalidation for all paths.
#
# Usage:
#   ./invalidation.sh <distribution-id>
#   DISTRIBUTION_ID=EXAMPLEID ./invalidation.sh
#
# Required environment / AWS credentials:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
#   (or an IAM role with cloudfront:CreateInvalidation permission)
#
# In GitHub Actions, set DISTRIBUTION_ID as a repository secret and call:
#   - name: Invalidate CloudFront cache
#     run: infra/cloudfront/invalidation.sh
#     env:
#       DISTRIBUTION_ID: ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }}

set -euo pipefail

DISTRIBUTION_ID="${1:-${DISTRIBUTION_ID:-}}"

if [[ -z "$DISTRIBUTION_ID" ]]; then
  echo "ERROR: CloudFront distribution ID is required." >&2
  echo "  Pass it as the first argument or set the DISTRIBUTION_ID environment variable." >&2
  exit 1
fi

echo "Creating CloudFront invalidation for distribution: $DISTRIBUTION_ID"

INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "Invalidation created: $INVALIDATION_ID"
echo "Waiting for invalidation to complete..."

aws cloudfront wait invalidation-completed \
  --distribution-id "$DISTRIBUTION_ID" \
  --id "$INVALIDATION_ID"

echo "Invalidation $INVALIDATION_ID completed successfully."
