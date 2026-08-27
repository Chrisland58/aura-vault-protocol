#!/usr/bin/env bash
# scripts/blue-green-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
# Blue-Green deployment orchestrator for Aura Vault Protocol
#
# Usage:
#   ./scripts/blue-green-deploy.sh [OPTIONS]
#
# Options:
#   --image-tag    <tag>   Docker image tag to deploy (required)
#   --namespace    <ns>    Kubernetes namespace (default: aura-vault)
#   --listener-arn <arn>   ALB HTTPS listener ARN (required for AWS mode)
#   --blue-tg-arn  <arn>   Blue target group ARN (required for AWS mode)
#   --green-tg-arn <arn>   Green target group ARN (required for AWS mode)
#   --preview-host <host>  Preview ingress hostname for smoke tests
#                          (default: preview.aura-vault.internal)
#   --timeout      <sec>   Max seconds to wait for rollout (default: 180)
#   --skip-aws             Skip ALB listener rule updates (k8s-only mode)
#   --dry-run              Print actions without executing them
#
# Environment variables (alternative to flags):
#   IMAGE_TAG, K8S_NAMESPACE, ALB_LISTENER_ARN,
#   BLUE_TG_ARN, GREEN_TG_ARN, PREVIEW_HOST
#
# Exit codes:
#   0  Success — traffic switched to new slot
#   1  Deployment failed — rolled back automatically
#   2  Rollback itself failed — requires manual intervention
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
IFS=$'\n\t'

# ── Colour helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${CYAN}[$(date -u '+%H:%M:%S')]${NC} $*"; }
success() { echo -e "${GREEN}[$(date -u '+%H:%M:%S')] ✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}[$(date -u '+%H:%M:%S')] ⚠ $*${NC}" >&2; }
error()   { echo -e "${RED}[$(date -u '+%H:%M:%S')] ✗ $*${NC}" >&2; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }

# ── Defaults ──────────────────────────────────────────────────────────────
IMAGE_TAG="${IMAGE_TAG:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-aura-vault}"
ALB_LISTENER_ARN="${ALB_LISTENER_ARN:-}"
BLUE_TG_ARN="${BLUE_TG_ARN:-}"
GREEN_TG_ARN="${GREEN_TG_ARN:-}"
PREVIEW_HOST="${PREVIEW_HOST:-preview.aura-vault.internal}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180}"
SKIP_AWS="${SKIP_AWS:-false}"
DRY_RUN="${DRY_RUN:-false}"
ROLLBACK_WINDOW_MINUTES=30    # acceptance criteria: keep old slot 30 min

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="${SCRIPT_DIR}/smoke-test.sh"

# ── Argument parsing ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-tag)    IMAGE_TAG="$2";        shift 2 ;;
    --namespace)    K8S_NAMESPACE="$2";    shift 2 ;;
    --listener-arn) ALB_LISTENER_ARN="$2"; shift 2 ;;
    --blue-tg-arn)  BLUE_TG_ARN="$2";     shift 2 ;;
    --green-tg-arn) GREEN_TG_ARN="$2";    shift 2 ;;
    --preview-host) PREVIEW_HOST="$2";    shift 2 ;;
    --timeout)      ROLLOUT_TIMEOUT="$2"; shift 2 ;;
    --skip-aws)     SKIP_AWS=true;        shift   ;;
    --dry-run)      DRY_RUN=true;         shift   ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────
if [[ -z "$IMAGE_TAG" ]]; then
  error "--image-tag is required"
  exit 1
fi

if [[ "$SKIP_AWS" == "false" ]]; then
  for v in ALB_LISTENER_ARN BLUE_TG_ARN GREEN_TG_ARN; do
    if [[ -z "${!v}" ]]; then
      error "--${v//_/-} is required (or set SKIP_AWS=true for k8s-only mode)"
      exit 1
    fi
  done
fi

# ── Dry-run wrapper ───────────────────────────────────────────────────────
run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}[DRY-RUN]${NC} $*"
    return 0
  fi
  "$@"
}

# ── Determine current active slot ─────────────────────────────────────────
get_active_slot() {
  # The stable Service annotation tracks the active slot.
  local annotation
  annotation=$(kubectl get service aura-vault-stable \
    --namespace "$K8S_NAMESPACE" \
    --output jsonpath='{.metadata.annotations.blue-green/active-slot}' 2>/dev/null || echo "")

  if [[ -z "$annotation" ]]; then
    # Fall back to reading the selector directly
    annotation=$(kubectl get service aura-vault-stable \
      --namespace "$K8S_NAMESPACE" \
      --output jsonpath='{.spec.selector.slot}' 2>/dev/null || echo "blue")
  fi

  echo "${annotation:-blue}"
}

# ── Deploy to a specific slot ─────────────────────────────────────────────
deploy_to_slot() {
  local slot="$1"

  log "Deploying image ghcr.io/soterika/aura-vault-protocol:${IMAGE_TAG} to ${slot} slot …"

  # Patch image in the slot's deployment
  run kubectl set image deployment/aura-vault-"${slot}" \
    backend="ghcr.io/soterika/aura-vault-protocol:${IMAGE_TAG}" \
    --namespace "$K8S_NAMESPACE"

  # Also update the version label so prometheus metrics carry the right tag
  run kubectl patch deployment aura-vault-"${slot}" \
    --namespace "$K8S_NAMESPACE" \
    --type merge \
    --patch "{\"spec\":{\"template\":{\"metadata\":{\"labels\":{\"version\":\"${IMAGE_TAG}\"}}}}}"

  log "Waiting for ${slot} rollout (timeout: ${ROLLOUT_TIMEOUT}s) …"
  run kubectl rollout status deployment/aura-vault-"${slot}" \
    --namespace "$K8S_NAMESPACE" \
    --timeout "${ROLLOUT_TIMEOUT}s"
}

# ── Point preview Service at standby slot ─────────────────────────────────
update_preview_service() {
  local standby_slot="$1"

  log "Pointing preview Service at standby slot: ${standby_slot} …"
  run kubectl patch service aura-vault-preview \
    --namespace "$K8S_NAMESPACE" \
    --type merge \
    --patch "{\"spec\":{\"selector\":{\"slot\":\"${standby_slot}\"}},\"metadata\":{\"annotations\":{\"blue-green/standby-slot\":\"${standby_slot}\"}}}"
}

# ── Switch production traffic to new slot ─────────────────────────────────
switch_traffic() {
  local new_slot="$1"
  local old_slot="$2"

  step "Switching production traffic → ${new_slot}"

  # 1. Kubernetes: patch stable Service selector (atomic for in-cluster traffic)
  run kubectl patch service aura-vault-stable \
    --namespace "$K8S_NAMESPACE" \
    --type merge \
    --patch "{\"spec\":{\"selector\":{\"slot\":\"${new_slot}\"}},\"metadata\":{\"annotations\":{\"blue-green/active-slot\":\"${new_slot}\"}}}"

  # 2. AWS ALB: update weighted forward rule to send 100% to new slot
  if [[ "$SKIP_AWS" == "false" ]]; then
    local new_tg_arn old_tg_arn
    if [[ "$new_slot" == "blue" ]]; then
      new_tg_arn="$BLUE_TG_ARN"
      old_tg_arn="$GREEN_TG_ARN"
    else
      new_tg_arn="$GREEN_TG_ARN"
      old_tg_arn="$BLUE_TG_ARN"
    fi

    log "Updating ALB listener rule weights (100% → ${new_slot}) …"
    run aws elbv2 modify-rule \
      --rule-arn "$(get_production_rule_arn)" \
      --actions "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"${new_tg_arn}\",\"Weight\":100},{\"TargetGroupArn\":\"${old_tg_arn}\",\"Weight\":0}],\"TargetGroupStickinessConfig\":{\"Enabled\":true,\"DurationSeconds\":1800}}}]"
  fi

  success "Traffic is now 100% on ${new_slot}"
}

# ── Get the production listener rule ARN ──────────────────────────────────
get_production_rule_arn() {
  aws elbv2 describe-rules \
    --listener-arn "$ALB_LISTENER_ARN" \
    --query "Rules[?Priority=='10'].RuleArn" \
    --output text
}

# ── Rollback ──────────────────────────────────────────────────────────────
rollback() {
  local bad_slot="$1"
  local good_slot="$2"

  warn "Rolling back! Switching traffic back to ${good_slot} …"

  # Kubernetes service selector
  if ! kubectl patch service aura-vault-stable \
      --namespace "$K8S_NAMESPACE" \
      --type merge \
      --patch "{\"spec\":{\"selector\":{\"slot\":\"${good_slot}\"}},\"metadata\":{\"annotations\":{\"blue-green/active-slot\":\"${good_slot}\"}}}" 2>/dev/null; then
    error "Kubernetes rollback failed — manual intervention required!"
    error "Run: kubectl patch service aura-vault-stable -n ${K8S_NAMESPACE} --patch '{\"spec\":{\"selector\":{\"slot\":\"${good_slot}\"}}}'"
    return 1
  fi

  # ALB weights
  if [[ "$SKIP_AWS" == "false" ]]; then
    local good_tg_arn bad_tg_arn
    if [[ "$good_slot" == "blue" ]]; then
      good_tg_arn="$BLUE_TG_ARN"
      bad_tg_arn="$GREEN_TG_ARN"
    else
      good_tg_arn="$GREEN_TG_ARN"
      bad_tg_arn="$BLUE_TG_ARN"
    fi

    if ! aws elbv2 modify-rule \
        --rule-arn "$(get_production_rule_arn)" \
        --actions "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"${good_tg_arn}\",\"Weight\":100},{\"TargetGroupArn\":\"${bad_tg_arn}\",\"Weight\":0}],\"TargetGroupStickinessConfig\":{\"Enabled\":true,\"DurationSeconds\":1800}}}]" 2>/dev/null; then
      error "ALB rollback failed — manually update listener rule to send all traffic to ${good_slot} TG"
      return 1
    fi
  fi

  success "Rolled back to ${good_slot}"
  return 0
}

# ── Schedule old slot cleanup ─────────────────────────────────────────────
# Scale down the old slot after the 30-minute rollback window.
# Implemented via a background job (kubectl annotate + a separate cleanup
# step in the GitHub Actions workflow) — here we emit an annotation that
# the cleanup job reads.
schedule_old_slot_cleanup() {
  local old_slot="$1"
  local cleanup_time
  cleanup_time=$(date -u -d "+${ROLLBACK_WINDOW_MINUTES} minutes" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u -v "+${ROLLBACK_WINDOW_MINUTES}M" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || echo "unknown")

  log "Old slot (${old_slot}) kept warm until ${cleanup_time} for instant rollback …"

  run kubectl annotate deployment aura-vault-"${old_slot}" \
    --namespace "$K8S_NAMESPACE" \
    "blue-green/scheduled-scale-down=${cleanup_time}" \
    "blue-green/scale-down-replicas=0" \
    --overwrite
}

# ── Print deployment summary ──────────────────────────────────────────────
print_summary() {
  local new_slot="$1"
  local old_slot="$2"
  local duration="$3"

  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║      Blue-Green Deploy Summary           ║${NC}"
  echo -e "${BOLD}╠══════════════════════════════════════════╣${NC}"
  echo -e "${BOLD}║${NC} Active slot   : ${GREEN}${new_slot}${NC}"
  echo -e "${BOLD}║${NC} Standby slot  : ${YELLOW}${old_slot}${NC} (warm, rollback ready)"
  echo -e "${BOLD}║${NC} Image tag     : ${IMAGE_TAG}"
  echo -e "${BOLD}║${NC} Duration      : ${duration}s"
  echo -e "${BOLD}║${NC} Rollback cmd  : ./scripts/blue-green-deploy.sh --image-tag <PREV_TAG>"
  echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

DEPLOY_START=$(date +%s)

step "Blue-Green Deployment — image: ${IMAGE_TAG}"
log "Namespace : ${K8S_NAMESPACE}"
log "DryRun    : ${DRY_RUN}"
log "SkipAWS   : ${SKIP_AWS}"

# ── Step 1: Determine slots ────────────────────────────────────────────────
ACTIVE_SLOT=$(get_active_slot)
if [[ "$ACTIVE_SLOT" == "blue" ]]; then
  STANDBY_SLOT="green"
else
  STANDBY_SLOT="blue"
fi

log "Current active slot : ${ACTIVE_SLOT}"
log "Deploying to        : ${STANDBY_SLOT}"

# ── Step 2: Deploy to standby ─────────────────────────────────────────────
step "Deploying to standby slot (${STANDBY_SLOT})"
if ! deploy_to_slot "$STANDBY_SLOT"; then
  error "Rollout to ${STANDBY_SLOT} failed — no traffic shifted, nothing to roll back"
  exit 1
fi
success "Rollout to ${STANDBY_SLOT} complete"

# ── Step 3: Point preview Service at standby ──────────────────────────────
update_preview_service "$STANDBY_SLOT"

# ── Step 4: Smoke test the standby (via preview ingress/service) ──────────
step "Running smoke tests against preview (${STANDBY_SLOT})"

SMOKE_TARGET="http://${PREVIEW_HOST}"
log "Smoke target: ${SMOKE_TARGET}"

if [[ "$DRY_RUN" == "false" ]]; then
  if ! SMOKE_TARGET="${SMOKE_TARGET}" bash "${SMOKE_SCRIPT}"; then
    error "Smoke tests FAILED on ${STANDBY_SLOT} slot"
    warn "Traffic was NOT switched. Attempting to restore preview Service …"
    kubectl patch service aura-vault-preview \
      --namespace "$K8S_NAMESPACE" \
      --type merge \
      --patch "{\"spec\":{\"selector\":{\"slot\":\"${STANDBY_SLOT}\"}}}" 2>/dev/null || true
    exit 1
  fi
fi
success "Smoke tests passed"

# ── Step 5: Switch production traffic ────────────────────────────────────
switch_traffic "$STANDBY_SLOT" "$ACTIVE_SLOT"

# ── Step 6: Post-switch smoke test (production endpoint) ─────────────────
step "Post-switch production smoke test"
if [[ -n "${PRODUCTION_URL:-}" ]] && [[ "$DRY_RUN" == "false" ]]; then
  log "Running post-switch smoke test on ${PRODUCTION_URL} …"
  # Brief back-off to let ALB propagate the weight change
  sleep 5
  if ! SMOKE_TARGET="${PRODUCTION_URL}" SMOKE_QUICK=true bash "${SMOKE_SCRIPT}"; then
    error "Post-switch smoke test FAILED — rolling back immediately"
    if ! rollback "$STANDBY_SLOT" "$ACTIVE_SLOT"; then
      error "ROLLBACK FAILED — manual intervention required!"
      error "Active slot should be: ${ACTIVE_SLOT}"
      error "Current (broken) slot: ${STANDBY_SLOT}"
      exit 2
    fi
    exit 1
  fi
  success "Post-switch smoke test passed"
else
  warn "PRODUCTION_URL not set — skipping post-switch smoke test"
fi

# ── Step 7: Schedule old slot warm-down ───────────────────────────────────
schedule_old_slot_cleanup "$ACTIVE_SLOT"

# ── Done ──────────────────────────────────────────────────────────────────
DEPLOY_END=$(date +%s)
DURATION=$(( DEPLOY_END - DEPLOY_START ))

print_summary "$STANDBY_SLOT" "$ACTIVE_SLOT" "$DURATION"
success "Deployment complete in ${DURATION}s"
