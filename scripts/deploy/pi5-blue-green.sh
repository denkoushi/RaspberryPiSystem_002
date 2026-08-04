#!/usr/bin/env bash
# Pi5 Phase 3 single-host Blue/Green deployment controller.
# Safety model: fixed gateway, immutable slot images, PostgreSQL scheduler lock,
# durable schema-v2 state, captured-image legacy recovery, and fail-closed guards.
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
# shellcheck source=lib/migration-gate.sh
source "$(dirname "$SCRIPT_PATH")/lib/migration-gate.sh"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
# shellcheck source=lib/pi5-blue-green/policy.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/policy.sh"
# shellcheck source=lib/pi5-blue-green/state.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/state.sh"
# shellcheck source=lib/pi5-blue-green/images-evidence.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/images-evidence.sh"
# shellcheck source=lib/pi5-blue-green/runtime.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/runtime.sh"
# shellcheck source=lib/pi5-blue-green/legacy.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/legacy.sh"
# shellcheck source=lib/pi5-blue-green/migrations.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/migrations.sh"
# shellcheck source=lib/pi5-blue-green/lifecycle.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/lifecycle.sh"
# shellcheck source=lib/pi5-blue-green/cleanup-reconcile.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/cleanup-reconcile.sh"
# shellcheck source=lib/pi5-blue-green/status.sh
source "$SCRIPT_DIR/lib/pi5-blue-green/status.sh"
PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
BASE_COMPOSE="${PI5_BASE_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
PHASE3_COMPOSE="${PI5_PHASE3_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.yml}"
PHASE3_MIGRATION_COMPOSE="${PI5_PHASE3_MIGRATION_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.migration.yml}"
ENV_FILE="${PI5_ENV_FILE:-${PROJECT_DIR}/infrastructure/docker/.env}"
PHASE2_STATE_FILE="${PI5_PHASE2_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-image-deploy-state.json}"
STATE_FILE="${PI5_BLUE_GREEN_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json}"
FLEET_STATE_FILE="${PI5_FLEET_STATE_FILE:-${PROJECT_DIR}/logs/deploy/fleet-release-state.json}"
LOCK_FILE="${PI5_BLUE_GREEN_LOCK_FILE:-${PROJECT_DIR}/logs/.pi5-blue-green.lock}"
CONFIG_DIR="${PI5_BLUE_GREEN_CONFIG_DIR:-${PROJECT_DIR}/logs/deploy/bluegreen}"
ALERT_DIR="${PI5_BLUE_GREEN_ALERT_DIR:-${PROJECT_DIR}/logs/alerts}"
COMPOSE_PROJECT="${PI5_BLUE_GREEN_COMPOSE_PROJECT:-bluegreen}"
GATEWAY_TEMPLATE="${PI5_GATEWAY_TEMPLATE:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.gateway.template}"
GATEWAY_HTTP_TEMPLATE="${PI5_GATEWAY_HTTP_TEMPLATE:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.gateway.http.template}"
GATEWAY_MAINTENANCE_TEMPLATE="${PI5_GATEWAY_MAINTENANCE_TEMPLATE:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.gateway.maintenance.template}"
# The legacy Web container selects its active Caddyfile at runtime.  Never
# assume the HTTP file: Pi5 normally uses /srv/Caddyfile.local for local TLS.
# An explicit maintenance file remains available for tightly controlled custom
# deployments; otherwise select the matching built-in configuration below.
LEGACY_MAINTENANCE_CONFIG="${PI5_LEGACY_MAINTENANCE_CONFIG:-}"
LEGACY_MAINTENANCE_HTTP_CONFIG="${PI5_LEGACY_MAINTENANCE_HTTP_CONFIG:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.http}"
LEGACY_MAINTENANCE_LOCAL_CONFIG="${PI5_LEGACY_MAINTENANCE_LOCAL_CONFIG:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.local}"
LEGACY_MAINTENANCE_PRODUCTION_CONFIG="${PI5_LEGACY_MAINTENANCE_PRODUCTION_CONFIG:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.production}"
API_HEALTH_URL="${PI5_BLUE_GREEN_HEALTH_URL:-https://127.0.0.1/api/system/health}"
WEB_URL="${PI5_BLUE_GREEN_WEB_URL:-https://127.0.0.1/}"
KIOSK_HEALTH_URL="${PI5_BLUE_GREEN_KIOSK_HEALTH_URL:-}"
ERROR_RATE_URL="${PI5_BLUE_GREEN_ERROR_RATE_URL:-}"
MAX_ERROR_RATE="${PI5_BLUE_GREEN_MAX_ERROR_RATE:-0.05}"
MIN_ERROR_SAMPLES="${PI5_BLUE_GREEN_MIN_ERROR_SAMPLES:-20}"
MIN_MEMORY_MB="${PI5_BLUE_GREEN_MIN_MEMORY_MB:-1536}"
MIN_DISK_GB="${PI5_BLUE_GREEN_MIN_DISK_GB:-10}"
MAX_LOAD_AVG="${PI5_BLUE_GREEN_MAX_LOAD_AVG:-}"
EVIDENCE_MIN_MEMORY_MB="${PI5_CANDIDATE_EVIDENCE_MIN_MEMORY_MB:-768}"
EVIDENCE_MIN_DISK_GB="${PI5_CANDIDATE_EVIDENCE_MIN_DISK_GB:-10}"
EVIDENCE_MAX_LOAD_AVG="${PI5_CANDIDATE_MAX_LOAD_AVG:-}"
STABLE_SECONDS="${PI5_BLUE_GREEN_STABLE_SECONDS:-300}"
MONITOR_INTERVAL="${PI5_BLUE_GREEN_MONITOR_INTERVAL:-2}"
# Runtime health remains sampled every MONITOR_INTERVAL. Immutable image,
# Compose-runtime, and Caddy structure is re-proved every 30 seconds and on the
# final sample instead of starting a Caddy validator process every two seconds.
MONITOR_STRUCTURAL_SAMPLE_INTERVAL="${PI5_BLUE_GREEN_MONITOR_STRUCTURAL_SAMPLE_INTERVAL:-15}"
READINESS_RETRIES="${PI5_BLUE_GREEN_READINESS_RETRIES:-45}"
READINESS_INTERVAL="${PI5_BLUE_GREEN_READINESS_INTERVAL:-2}"
# Pi5's Docker port handoff from legacy Web to the fixed gateway can take
# longer than the Caddy process itself. Keep maintenance mode and wait up to a
# minute before treating the host listener as failed.
GATEWAY_READY_RETRIES="${PI5_BLUE_GREEN_GATEWAY_READY_RETRIES:-60}"
GATEWAY_READY_INTERVAL="${PI5_BLUE_GREEN_GATEWAY_READY_INTERVAL:-1}"
DRY_RUN="${PI5_BLUE_GREEN_DRY_RUN:-${DRY_RUN:-0}}"
HTTP_ONLY="${PI5_BLUE_GREEN_HTTP_ONLY:-0}"
RUNTIME_CONFIG_VERIFIER="${PI5_RUNTIME_CONFIG_VERIFIER:-${PROJECT_DIR}/scripts/deploy/pi5-runtime-config-verifier.py}"
RELEASE_EVIDENCE_HELPER="${PROJECT_DIR}/scripts/deploy/pi5-release-evidence.py"

COMMAND="${1:-}"
CONFIRM_BOOTSTRAP=0
ALLOW_LEGACY_HANDOFF=0
RESTORE_LEGACY=0
STRUCTURAL_ONLY=0
API_IMAGE=""
WEB_IMAGE=""
ROLLBACK_REASON=""
RUN_ID=""
MIGRATION_PLAN_FILE=""
RESOURCE_EVIDENCE_FILE=""
CANDIDATE_API_IMAGE_ID=""
CANDIDATE_WEB_IMAGE_ID=""
BLUE_API_IMAGE_ID=""
BLUE_WEB_IMAGE_ID=""
GREEN_API_IMAGE_ID=""
GREEN_WEB_IMAGE_ID=""
RETIRED_API_IMAGE=""
RETIRED_WEB_IMAGE=""
RETIRED_API_IMAGE_ID=""
RETIRED_WEB_IMAGE_ID=""
RELEASE_RUN_ID=""
RELEASE_DESIRED_SHA=""
RELEASE_RESOURCE_EVIDENCE=""
RELEASE_RESOURCE_EVIDENCE_SHA256=""
LOCK_DIR=""
LOCK_FALLBACK=0
BOOTSTRAP_RECOVERY_ARMED=0
PREPARE_RECOVERY_ARMED=0

ACTIVE_SLOT=""
CANDIDATE_SLOT=""
PREVIOUS_SLOT=""
BLUE_API_IMAGE=""
BLUE_WEB_IMAGE=""
GREEN_API_IMAGE=""
GREEN_WEB_IMAGE=""
GATEWAY_MODE="offline"
GATEWAY_SLOT=""
STABLE_UNTIL=""
MONITOR_ACTIVE_SLOT=""
MONITOR_ROLLBACK_SLOT=""
MIGRATION_BASE_COMMIT=""
MIGRATION_CANDIDATE_COMMIT=""
MIGRATION_STATUS="not-checked"
MIGRATION_CHECKED_AT=""
MIGRATION_APPLIED_AT=""
LEGACY_API_ID=""
LEGACY_WEB_ID=""
LEGACY_API_IMAGE=""
LEGACY_WEB_IMAGE=""
LEGACY_API_RESTART="always"
LEGACY_WEB_RESTART="always"
LEGACY_API_WAS_RUNNING=0
LEGACY_WEB_WAS_RUNNING=0
LEGACY_API_QUARANTINED=0
LEGACY_WEB_QUARANTINED=0
LEGACY_API_REMOVED=0
LEGACY_WEB_REMOVED=0
LEGACY_API_REMOVE_INTENT=0
LEGACY_WEB_REMOVE_INTENT=0
LEGACY_WEB_MAINTENANCE=0
LEGACY_NORMAL_CONFIG_B64=""
LEGACY_CADDY_CONFIG_PATH=""

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
is_slot() { [[ "${1:-}" == blue || "${1:-}" == green ]]; }
other_slot() { [[ "$1" == blue ]] && printf 'green\n' || printf 'blue\n'; }
json_bool() { [[ "${1:-0}" == 1 ]] && printf true || printf false; }

usage() {
  cat <<'EOF'
Usage: pi5-blue-green.sh <status|bootstrap|prepare|switch|rollback|cleanup|reconcile|monitor> [options]
  --api-image IMAGE                    immutable API candidate image
  --web-image IMAGE                    immutable Web candidate image
  --confirm-bootstrap                  required for first gateway cutover
  --allow-legacy-scheduler-handoff     required for first scheduler handoff
  --restore-legacy                     reconcile only: restore captured legacy services
  --reason TEXT                        operator rollback reason
  --run-id RUN_ID                      owning rolling-release run
  --migration-plan FILE                sealed migration-plan evidence
  --resource-evidence FILE             sealed candidate resource evidence
  --dry-run                            suppress Docker mutations; retain guards/state/rendering
EOF
}

[[ -n "$COMMAND" ]] || { usage; exit 2; }
shift || true
while (($#)); do
  case "$1" in
    --api-image) [[ $# -ge 2 ]] || die '--api-image requires a value'; API_IMAGE="$2"; shift 2 ;;
    --web-image) [[ $# -ge 2 ]] || die '--web-image requires a value'; WEB_IMAGE="$2"; shift 2 ;;
    --confirm-bootstrap) CONFIRM_BOOTSTRAP=1; shift ;;
    --allow-legacy-scheduler-handoff) ALLOW_LEGACY_HANDOFF=1; shift ;;
    --restore-legacy) RESTORE_LEGACY=1; shift ;;
    --reason) [[ $# -ge 2 ]] || die '--reason requires a value'; ROLLBACK_REASON="$2"; shift 2 ;;
    --run-id) [[ $# -ge 2 ]] || die '--run-id requires a value'; RUN_ID="$2"; shift 2 ;;
    --migration-plan) [[ $# -ge 2 ]] || die '--migration-plan requires a value'; MIGRATION_PLAN_FILE="$2"; shift 2 ;;
    --resource-evidence) [[ $# -ge 2 ]] || die '--resource-evidence requires a value'; RESOURCE_EVIDENCE_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$COMMAND" in
  status|bootstrap|prepare|switch|rollback|cleanup|reconcile|monitor|seal-image-ids|migration-ledger|restart-monitor) ;;
  *) usage; exit 2 ;;
esac
((RESTORE_LEGACY == 0)) || [[ "$COMMAND" == reconcile ]] || die '--restore-legacy is valid only with reconcile'
[[ "$GATEWAY_READY_RETRIES" =~ ^[1-9][0-9]*$ ]] || die 'gateway readiness retries must be a positive integer'
[[ "$GATEWAY_READY_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'gateway readiness interval must be a non-negative number'

validate_fixed_safety_policy
enable_prior_handoff_recovery_mode

mkdir -p "$(dirname "$LOCK_FILE")"
case "$COMMAND" in
  status) ;;
  *)
    if command -v flock >/dev/null 2>&1; then
      exec 9>"$LOCK_FILE"; flock -n 9 || die 'another Pi5 Blue/Green operation is running'
    else
      LOCK_DIR="${LOCK_FILE}.d"; mkdir "$LOCK_DIR" 2>/dev/null || die 'another Pi5 Blue/Green operation is running'
      LOCK_FALLBACK=1; trap lock_cleanup EXIT
    fi
    ;;
esac

case "$COMMAND" in
  status) status_report ;;
  bootstrap) bootstrap ;;
  prepare) prepare ;;
  switch) switch_candidate ;;
  rollback) rollback ;;
  cleanup) cleanup ;;
  reconcile) reconcile ;;
  monitor) monitor ;;
  seal-image-ids) seal_legacy_state_image_ids ;;
  migration-ledger) live_migration_ledger ;;
  restart-monitor) restart_stability_window ;;
esac
