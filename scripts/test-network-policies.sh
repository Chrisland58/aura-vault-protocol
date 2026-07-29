#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/test-network-policies.sh
#
# Validates Kubernetes NetworkPolicies by running kubectl exec probes from
# pods that SHOULD be blocked to confirm deny-all is working, and from pods
# that SHOULD have access to confirm the allow rules are correct.
#
# Usage:
#   ./scripts/test-network-policies.sh [--namespace aura-vault]
#
# Prerequisites:
#   - kubectl configured and pointing at the correct cluster/context
#   - Network policies applied: kubectl apply -f k8s/network-policies/
#   - Pods running in aura-vault and monitoring namespaces
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NS="${1:-aura-vault}"
PASS=0
FAIL=0
SKIP=0

# ── Helpers ───────────────────────────────────────────────────────────────────
green() { echo -e "\033[32m✓ $*\033[0m"; }
red()   { echo -e "\033[31m✗ $*\033[0m"; }
yellow(){ echo -e "\033[33m~ $*\033[0m"; }

# expect_blocked: test that a connection is REFUSED/TIMEOUT (policy working)
expect_blocked() {
  local label="$1" pod="$2" target_host="$3" target_port="$4"
  echo -n "  [BLOCKED expected] ${label} ... "

  if kubectl exec -n "${NS}" "${pod}" -- \
       timeout 5 bash -c "echo > /dev/tcp/${target_host}/${target_port}" \
       2>/dev/null; then
    red "FAIL — connection succeeded (policy not enforced!)"
    ((FAIL++))
  else
    green "PASS — connection blocked as expected"
    ((PASS++))
  fi
}

# expect_allowed: test that a connection SUCCEEDS (policy not too restrictive)
expect_allowed() {
  local label="$1" pod="$2" target_host="$3" target_port="$4"
  echo -n "  [ALLOWED expected] ${label} ... "

  if kubectl exec -n "${NS}" "${pod}" -- \
       timeout 5 bash -c "echo > /dev/tcp/${target_host}/${target_port}" \
       2>/dev/null; then
    green "PASS — connection allowed as expected"
    ((PASS++))
  else
    red "FAIL — connection blocked (policy too restrictive!)"
    ((FAIL++))
  fi
}

# skip if pod not found
get_pod() {
  kubectl get pods -n "${NS}" -l "app=$1" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo ""
}

echo "═══════════════════════════════════════════════════════════"
echo " Aura Vault NetworkPolicy Validation"
echo " Namespace: ${NS}"
echo "═══════════════════════════════════════════════════════════"

# ── Resolve pod names ─────────────────────────────────────────────────────────
FRONTEND_POD=$(get_pod frontend)
BACKEND_POD=$(get_pod backend)
POSTGRES_POD=$(get_pod postgres)
REDIS_POD=$(get_pod redis)

for pod_var in FRONTEND_POD BACKEND_POD POSTGRES_POD REDIS_POD; do
  if [[ -z "${!pod_var}" ]]; then
    yellow "SKIP — ${pod_var} not found in namespace ${NS}"
    ((SKIP++))
  fi
done

echo ""
echo "── 1. Default-deny: frontend should NOT reach postgres directly ──"
if [[ -n "${FRONTEND_POD}" && -n "${POSTGRES_POD}" ]]; then
  PG_IP=$(kubectl get pod -n "${NS}" "${POSTGRES_POD}" -o jsonpath='{.status.podIP}')
  expect_blocked "frontend → postgres:5432" "${FRONTEND_POD}" "${PG_IP}" "5432"
else
  yellow "SKIP — pods not available"
fi

echo ""
echo "── 2. Default-deny: frontend should NOT reach redis directly ──"
if [[ -n "${FRONTEND_POD}" && -n "${REDIS_POD}" ]]; then
  REDIS_IP=$(kubectl get pod -n "${NS}" "${REDIS_POD}" -o jsonpath='{.status.podIP}')
  expect_blocked "frontend → redis:6379" "${FRONTEND_POD}" "${REDIS_IP}" "6379"
else
  yellow "SKIP — pods not available"
fi

echo ""
echo "── 3. Backend should reach postgres ──"
if [[ -n "${BACKEND_POD}" && -n "${POSTGRES_POD}" ]]; then
  PG_IP=$(kubectl get pod -n "${NS}" "${POSTGRES_POD}" -o jsonpath='{.status.podIP}')
  expect_allowed "backend → postgres:5432" "${BACKEND_POD}" "${PG_IP}" "5432"
else
  yellow "SKIP — pods not available"
fi

echo ""
echo "── 4. Backend should reach redis ──"
if [[ -n "${BACKEND_POD}" && -n "${REDIS_POD}" ]]; then
  REDIS_IP=$(kubectl get pod -n "${NS}" "${REDIS_POD}" -o jsonpath='{.status.podIP}')
  expect_allowed "backend → redis:6379" "${BACKEND_POD}" "${REDIS_IP}" "6379"
else
  yellow "SKIP — pods not available"
fi

echo ""
echo "── 5. Frontend should reach backend ──"
if [[ -n "${FRONTEND_POD}" && -n "${BACKEND_POD}" ]]; then
  BE_IP=$(kubectl get pod -n "${NS}" "${BACKEND_POD}" -o jsonpath='{.status.podIP}')
  expect_allowed "frontend → backend:4000" "${FRONTEND_POD}" "${BE_IP}" "4000"
else
  yellow "SKIP — pods not available"
fi

echo ""
echo "── 6. Postgres should NOT reach backend (no egress besides DNS) ──"
if [[ -n "${POSTGRES_POD}" && -n "${BACKEND_POD}" ]]; then
  BE_IP=$(kubectl get pod -n "${NS}" "${BACKEND_POD}" -o jsonpath='{.status.podIP}')
  expect_blocked "postgres → backend:4000" "${POSTGRES_POD}" "${BE_IP}" "4000"
else
  yellow "SKIP — pods not available"
fi

echo ""
echo "── 7. Prometheus (monitoring ns) should scrape backend metrics ──"
PROMETHEUS_POD=$(kubectl get pods -n monitoring -l "app.kubernetes.io/name=prometheus" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "${PROMETHEUS_POD}" && -n "${BACKEND_POD}" ]]; then
  BE_IP=$(kubectl get pod -n "${NS}" "${BACKEND_POD}" -o jsonpath='{.status.podIP}')
  echo -n "  [ALLOWED expected] prometheus → backend:9090 ... "
  if kubectl exec -n monitoring "${PROMETHEUS_POD}" -- \
       timeout 5 bash -c "echo > /dev/tcp/${BE_IP}/9090" 2>/dev/null; then
    green "PASS — Prometheus can scrape backend"
    ((PASS++))
  else
    red "FAIL — Prometheus cannot scrape backend"
    ((FAIL++))
  fi
else
  yellow "SKIP — prometheus pod not found in monitoring namespace"
  ((SKIP++))
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " Results: ${PASS} passed | ${FAIL} failed | ${SKIP} skipped"
echo "═══════════════════════════════════════════════════════════"

[[ "${FAIL}" -eq 0 ]] && exit 0 || exit 1
