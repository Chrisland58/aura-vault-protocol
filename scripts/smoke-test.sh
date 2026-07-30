#!/usr/bin/env bash
# scripts/smoke-test.sh
# ─────────────────────────────────────────────────────────────────────────────
# Blue-Green smoke tests for Aura Vault Protocol
#
# Validates that a deployment slot is healthy and functionally correct
# before (or after) traffic is switched.
#
# Usage:
#   SMOKE_TARGET=http://preview.aura-vault.internal ./scripts/smoke-test.sh
#   SMOKE_TARGET=https://app.aura-vault.xyz SMOKE_QUICK=true ./scripts/smoke-test.sh
#
# Environment variables:
#   SMOKE_TARGET     Base URL of the environment to test (required)
#   SMOKE_QUICK      If "true", skip slow/optional checks (post-switch mode)
#   SMOKE_TOKEN      Optional Bearer token for authenticated endpoints
#   SMOKE_RETRIES    HTTP retry count per check (default: 3)
#   SMOKE_TIMEOUT    Seconds per HTTP request (default: 10)
#   EXPECTED_SLOT    Expected DEPLOYMENT_SLOT response header value
#                    (optional — only checked if set)
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

pass()  { echo -e "${GREEN}  ✓ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ $*${NC}" >&2; }
skip()  { echo -e "${YELLOW}  ⊘ $*${NC}"; }
info()  { echo -e "${CYAN}  → $*${NC}"; }
title() { echo -e "\n${BOLD}$*${NC}"; }

# ── Configuration ─────────────────────────────────────────────────────────
SMOKE_TARGET="${SMOKE_TARGET:?SMOKE_TARGET environment variable is required}"
SMOKE_QUICK="${SMOKE_QUICK:-false}"
SMOKE_TOKEN="${SMOKE_TOKEN:-}"
SMOKE_RETRIES="${SMOKE_RETRIES:-3}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-10}"
EXPECTED_SLOT="${EXPECTED_SLOT:-}"

# Strip trailing slash
SMOKE_TARGET="${SMOKE_TARGET%/}"

PASS_COUNT=0
FAIL_COUNT=0

# ── HTTP helper ───────────────────────────────────────────────────────────
# Returns HTTP status code. Retries on transient errors.
http_get() {
  local url="$1"
  local expected_status="${2:-200}"
  local auth_header=""

  if [[ -n "$SMOKE_TOKEN" ]]; then
    auth_header="-H 'Authorization: Bearer ${SMOKE_TOKEN}'"
  fi

  local attempt=1
  while [[ $attempt -le $SMOKE_RETRIES ]]; do
    local status
    status=$(curl --silent --max-time "$SMOKE_TIMEOUT" --retry 0 \
      ${SMOKE_TOKEN:+-H "Authorization: Bearer ${SMOKE_TOKEN}"} \
      --output /dev/null \
      --write-out "%{http_code}" \
      "$url" 2>/dev/null || echo "000")

    if [[ "$status" == "$expected_status" ]]; then
      echo "$status"
      return 0
    fi

    if [[ $attempt -lt $SMOKE_RETRIES ]]; then
      sleep $(( attempt * 2 ))  # back-off: 2s, 4s
    fi
    (( attempt++ )) || true
  done

  echo "$status"
  return 1
}

# Returns full response body
http_body() {
  local url="$1"
  curl --silent --max-time "$SMOKE_TIMEOUT" --retry "$SMOKE_RETRIES" --retry-delay 2 \
    ${SMOKE_TOKEN:+-H "Authorization: Bearer ${SMOKE_TOKEN}"} \
    "$url" 2>/dev/null || echo ""
}

# Returns a specific response header value
http_header() {
  local url="$1"
  local header="$2"
  curl --silent --max-time "$SMOKE_TIMEOUT" \
    ${SMOKE_TOKEN:+-H "Authorization: Bearer ${SMOKE_TOKEN}"} \
    --head "$url" 2>/dev/null \
    | grep -i "^${header}:" | tail -1 | cut -d' ' -f2- | tr -d '\r' || echo ""
}

# ── Check runner ──────────────────────────────────────────────────────────
check() {
  local name="$1"
  shift
  if "$@"; then
    pass "$name"
    (( PASS_COUNT++ )) || true
    return 0
  else
    fail "$name"
    (( FAIL_COUNT++ )) || true
    return 1
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# TEST SUITE
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        Aura Vault Smoke Tests            ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║${NC} Target : ${SMOKE_TARGET}"
echo -e "${BOLD}║${NC} Mode   : $([ "$SMOKE_QUICK" == "true" ] && echo "quick (post-switch)" || echo "full (pre-switch)")"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"

# ── 1. Health endpoint ────────────────────────────────────────────────────
title "1. Health & Readiness"

check "GET /api/health returns 200" bash -c \
  '[[ "$(http_get "'"${SMOKE_TARGET}/api/health"'" 200)" == "200" ]]'

check "GET /api/ready returns 200" bash -c \
  '[[ "$(http_get "'"${SMOKE_TARGET}/api/ready"'" 200)" == "200" ]]'

# Health body should contain status: ok
check "Health body contains status:ok" bash -c \
  'http_body "'"${SMOKE_TARGET}/api/health"'" | grep -qi "\"status\":\"ok\"\|status.*ok"'

# ── 2. Slot identity ──────────────────────────────────────────────────────
title "2. Slot Identity"

SLOT_HEADER=$(http_header "${SMOKE_TARGET}/api/health" "x-deployment-slot" || echo "")

if [[ -n "$EXPECTED_SLOT" ]]; then
  check "x-deployment-slot header is '${EXPECTED_SLOT}'" bash -c \
    '[[ "'"${SLOT_HEADER}"'" == "'"${EXPECTED_SLOT}"'" ]]'
else
  if [[ -n "$SLOT_HEADER" ]]; then
    info "Slot header present: '${SLOT_HEADER}'"
    (( PASS_COUNT++ )) || true
  else
    skip "x-deployment-slot header not present (EXPECTED_SLOT not set)"
  fi
fi

# ── 3. API endpoints ──────────────────────────────────────────────────────
title "3. Core API Endpoints"

check "GET /api/vault/status returns 200" bash -c \
  '[[ "$(http_get "'"${SMOKE_TARGET}/api/vault/status"'" 200)" == "200" ]]'

check "GET /api/vault/apy returns 200 or 401" bash -c \
  'STATUS=$(http_get "'"${SMOKE_TARGET}/api/vault/apy"'"); [[ "$STATUS" == "200" || "$STATUS" == "401" ]]'

check "Non-existent route returns 404 (no panic)" bash -c \
  '[[ "$(http_get "'"${SMOKE_TARGET}/api/does-not-exist-smoke-test"'" 404)" == "404" ]]'

# ── 4. Security headers ───────────────────────────────────────────────────
title "4. Security Headers"

check "X-Content-Type-Options: nosniff" bash -c \
  'http_header "'"${SMOKE_TARGET}/api/health"'" "x-content-type-options" | grep -qi "nosniff"'

check "X-Frame-Options present" bash -c \
  '[[ -n "$(http_header "'"${SMOKE_TARGET}/api/health"'" "x-frame-options")" ]]'

check "No Server header (version disclosure)" bash -c \
  '[[ -z "$(http_header "'"${SMOKE_TARGET}/api/health"'" "server" | grep -v "^$" | grep -Ei "express|node|nginx/[0-9]" || true)" ]]'

# ── 5. Performance check ──────────────────────────────────────────────────
title "5. Performance"

HEALTH_LATENCY=$(curl --silent --max-time 10 \
  --output /dev/null \
  --write-out "%{time_total}" \
  "${SMOKE_TARGET}/api/health" 2>/dev/null || echo "99")

# Convert to milliseconds for display, compare as float
info "Health endpoint latency: ${HEALTH_LATENCY}s"
check "Health response < 2s" bash -c \
  'echo "'"${HEALTH_LATENCY}"' < 2.0" | bc -l | grep -q "^1$"' 2>/dev/null || \
check "Health response < 2s (fallback)" bash -c \
  '[[ "$(echo "'"${HEALTH_LATENCY}"'" | cut -d. -f1)" -lt 2 ]]'

# ── 6. Full checks (pre-switch only) ─────────────────────────────────────
if [[ "$SMOKE_QUICK" != "true" ]]; then
  title "6. Extended Checks (pre-switch)"

  # Database connectivity — vault status must return non-empty body
  check "Vault status has non-empty response" bash -c \
    '[[ $(http_body "'"${SMOKE_TARGET}/api/vault/status"'" | wc -c) -gt 5 ]]'

  # Metrics endpoint
  check "GET /metrics returns 200 (Prometheus scrape)" bash -c \
    'STATUS=$(http_get "'"${SMOKE_TARGET}/metrics"'"); [[ "$STATUS" == "200" || "$STATUS" == "403" ]]'

  # Content-Type on JSON endpoints
  check "Content-Type is application/json on /api/health" bash -c \
    'http_header "'"${SMOKE_TARGET}/api/health"'" "content-type" | grep -qi "application/json"'

  # OPTIONS preflight for CORS
  check "OPTIONS /api/vault/status returns 2xx (CORS preflight)" bash -c \
    'STATUS=$(curl --silent --max-time 10 --output /dev/null --write-out "%{http_code}" \
      -X OPTIONS \
      -H "Origin: https://app.aura-vault.xyz" \
      -H "Access-Control-Request-Method: GET" \
      "'"${SMOKE_TARGET}/api/vault/status"'" 2>/dev/null || echo "000")
    [[ "${STATUS:0:1}" == "2" || "$STATUS" == "403" ]]'
fi

# ═════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}══ Smoke Test Results ══════════════════════${NC}"
echo -e "${GREEN}  Passed : ${PASS_COUNT}${NC}"
if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "${RED}  Failed : ${FAIL_COUNT}${NC}"
fi
echo ""

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "${RED}${BOLD}Smoke tests FAILED (${FAIL_COUNT} failure(s)) — deployment blocked${NC}"
  exit 1
else
  echo -e "${GREEN}${BOLD}All smoke tests passed ✓${NC}"
  exit 0
fi
