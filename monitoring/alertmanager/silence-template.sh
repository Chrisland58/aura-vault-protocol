#!/usr/bin/env bash
# silence-template.sh — Create a maintenance window silence in AlertManager
#
# Usage:
#   ./silence-template.sh --duration 2h --comment "Scheduled maintenance window"
#   ./silence-template.sh --duration 30m --alertname ServiceDown --comment "Restarting frontend"
#   ./silence-template.sh --duration 1h --env production --comment "DB migration"
#
# Environment variables:
#   ALERTMANAGER_URL  AlertManager base URL (default: http://localhost:9093)
#
# Requirements: curl, jq
#
# Examples:
#   # Silence all alerts for 2 hours
#   ALERTMANAGER_URL=http://alertmanager:9093 \
#     ./silence-template.sh --duration 2h --comment "Planned maintenance"
#
#   # Silence ServiceDown for the production namespace for 30 minutes
#   ./silence-template.sh \
#     --duration 30m \
#     --alertname ServiceDown \
#     --env production \
#     --comment "Restarting backend pods"

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://localhost:9093}"
DURATION=""
COMMENT=""
ALERTNAME=""
ENVIRONMENT=""
AUTHOR="${USER:-automation}"

# ── Argument parsing ──────────────────────────────────────────────────────────
usage() {
  echo "Usage: $0 --duration <duration> --comment <comment> [--alertname <name>] [--env <environment>]"
  echo ""
  echo "Options:"
  echo "  --duration   Duration (e.g. 30m, 2h, 1d)          [required]"
  echo "  --comment    Reason for silence                     [required]"
  echo "  --alertname  Alert name to match (optional)"
  echo "  --env        Environment label to match (optional)"
  echo "  --author     Author name (default: \$USER)"
  echo ""
  echo "Environment variables:"
  echo "  ALERTMANAGER_URL  AlertManager base URL (default: http://localhost:9093)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)  DURATION="$2";    shift 2 ;;
    --comment)   COMMENT="$2";     shift 2 ;;
    --alertname) ALERTNAME="$2";   shift 2 ;;
    --env)       ENVIRONMENT="$2"; shift 2 ;;
    --author)    AUTHOR="$2";      shift 2 ;;
    -h|--help)   usage ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────
if [[ -z "$DURATION" ]]; then
  echo "ERROR: --duration is required" >&2
  usage
fi

if [[ -z "$COMMENT" ]]; then
  echo "ERROR: --comment is required" >&2
  usage
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required but not installed" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

# Validate ALERTMANAGER_URL is accessible
if ! curl -sf "${ALERTMANAGER_URL}/-/healthy" &>/dev/null; then
  echo "ERROR: AlertManager is not reachable at ${ALERTMANAGER_URL}" >&2
  exit 1
fi

# ── Duration to seconds ───────────────────────────────────────────────────────
duration_to_seconds() {
  local duration="$1"
  local value="${duration%[mhd]}"
  local unit="${duration##*[0-9]}"

  case "$unit" in
    m) echo $((value * 60)) ;;
    h) echo $((value * 3600)) ;;
    d) echo $((value * 86400)) ;;
    *) echo "ERROR: Unknown duration unit '${unit}'. Use m, h, or d." >&2; exit 1 ;;
  esac
}

DURATION_SECONDS=$(duration_to_seconds "$DURATION")
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
END_TIME=$(date -u -d "+${DURATION_SECONDS} seconds" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || \
           date -u -v "+${DURATION_SECONDS}S" +"%Y-%m-%dT%H:%M:%S.000Z")

# ── Build matchers array ──────────────────────────────────────────────────────
MATCHERS="[]"

# Always match any non-empty alertname or all alerts
if [[ -n "$ALERTNAME" ]]; then
  MATCHERS=$(echo "$MATCHERS" | jq \
    --arg name "alertname" \
    --arg value "$ALERTNAME" \
    '. + [{"name": $name, "value": $value, "isRegex": false, "isEqual": true}]')
fi

if [[ -n "$ENVIRONMENT" ]]; then
  MATCHERS=$(echo "$MATCHERS" | jq \
    --arg name "environment" \
    --arg value "$ENVIRONMENT" \
    '. + [{"name": $name, "value": $value, "isRegex": false, "isEqual": true}]')
fi

# If no specific matchers, match all alerts with a wildcard on alertname
if [[ "$MATCHERS" == "[]" ]]; then
  MATCHERS='[{"name":"alertname","value":".*","isRegex":true,"isEqual":true}]'
fi

# ── Build request payload ─────────────────────────────────────────────────────
PAYLOAD=$(jq -n \
  --argjson matchers "$MATCHERS" \
  --arg startsAt   "$START_TIME" \
  --arg endsAt     "$END_TIME" \
  --arg createdBy  "$AUTHOR" \
  --arg comment    "$COMMENT" \
  '{
    matchers:  $matchers,
    startsAt:  $startsAt,
    endsAt:    $endsAt,
    createdBy: $createdBy,
    comment:   $comment
  }')

echo "Creating silence with payload:"
echo "$PAYLOAD" | jq .

# ── POST to AlertManager ──────────────────────────────────────────────────────
RESPONSE=$(curl -sf \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${ALERTMANAGER_URL}/api/v2/silences")

SILENCE_ID=$(echo "$RESPONSE" | jq -r '.silenceID')

echo ""
echo "✅ Silence created successfully!"
echo "   Silence ID : ${SILENCE_ID}"
echo "   Duration   : ${DURATION} (${DURATION_SECONDS}s)"
echo "   Starts at  : ${START_TIME}"
echo "   Ends at    : ${END_TIME}"
echo "   Comment    : ${COMMENT}"
echo "   Author     : ${AUTHOR}"
echo ""
echo "View silence: ${ALERTMANAGER_URL}/#/silences/${SILENCE_ID}"
echo ""
echo "To expire this silence early:"
echo "  curl -X DELETE ${ALERTMANAGER_URL}/api/v2/silence/${SILENCE_ID}"
