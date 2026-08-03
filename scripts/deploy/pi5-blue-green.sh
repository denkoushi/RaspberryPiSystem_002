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
PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
BASE_COMPOSE="${PI5_BASE_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
PHASE3_COMPOSE="${PI5_PHASE3_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.yml}"
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

legacy_web_env_has_value() {
  local key="$1"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$LEGACY_WEB_ID" |
    awk -F= -v key="$key" '$1 == key && length($2) > 0 { found=1; exit } END { exit(found ? 0 : 1) }'
}
legacy_caddy_config_path() {
  # Keep this priority identical to infrastructure/docker/Dockerfile.web.
  if legacy_web_env_has_value USE_LOCAL_CERTS; then
    printf '%s\n' '/srv/Caddyfile.local'
  elif legacy_web_env_has_value DOMAIN; then
    printf '%s\n' '/srv/Caddyfile.production'
  else
    printf '%s\n' '/srv/Caddyfile'
  fi
}
legacy_maintenance_config_path() {
  local caddy_path="$1"
  if [[ -n "$LEGACY_MAINTENANCE_CONFIG" ]]; then
    printf '%s\n' "$LEGACY_MAINTENANCE_CONFIG"
    return 0
  fi
  case "$caddy_path" in
    /srv/Caddyfile.local) printf '%s\n' "$LEGACY_MAINTENANCE_LOCAL_CONFIG" ;;
    /srv/Caddyfile.production) printf '%s\n' "$LEGACY_MAINTENANCE_PRODUCTION_CONFIG" ;;
    /srv/Caddyfile) printf '%s\n' "$LEGACY_MAINTENANCE_HTTP_CONFIG" ;;
    *) return 1 ;;
  esac
}
legacy_capture() {
  if [[ "$DRY_RUN" == 1 ]]; then
    LEGACY_API_ID='dry-run-legacy-api'; LEGACY_WEB_ID='dry-run-legacy-web'
    LEGACY_API_IMAGE="${LEGACY_API_IMAGE:-registry/legacy-api:1111111111111111111111111111111111111111-captured}"
    LEGACY_WEB_IMAGE="${LEGACY_WEB_IMAGE:-registry/legacy-web:1111111111111111111111111111111111111111-captured}"
    LEGACY_API_RESTART=always; LEGACY_WEB_RESTART=always
    LEGACY_API_WAS_RUNNING=1; LEGACY_WEB_WAS_RUNNING=1
    # Keep dry-run state compact; full Caddyfile capture is for real cutovers only.
    LEGACY_NORMAL_CONFIG_B64='dry-run-captured-normal-caddyfile'
    LEGACY_CADDY_CONFIG_PATH='/srv/Caddyfile'
    return 0
  fi
  LEGACY_API_ID="$(legacy_service_id api)"; LEGACY_WEB_ID="$(legacy_service_id web)"
  [[ -n "$LEGACY_API_ID" && -n "$LEGACY_WEB_ID" ]] || return 1
  LEGACY_API_IMAGE="$(container_image "$LEGACY_API_ID")"; LEGACY_WEB_IMAGE="$(container_image "$LEGACY_WEB_ID")"
  LEGACY_API_RESTART="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$LEGACY_API_ID")"
  LEGACY_WEB_RESTART="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$LEGACY_WEB_ID")"
  docker_running "$LEGACY_API_ID" && LEGACY_API_WAS_RUNNING=1 || LEGACY_API_WAS_RUNNING=0
  docker_running "$LEGACY_WEB_ID" && LEGACY_WEB_WAS_RUNNING=1 || LEGACY_WEB_WAS_RUNNING=0
  LEGACY_CADDY_CONFIG_PATH="$(legacy_caddy_config_path)" || return 1
  LEGACY_NORMAL_CONFIG_B64="$(docker exec "$LEGACY_WEB_ID" sh -c "cat '$LEGACY_CADDY_CONFIG_PATH'" | base64 | tr -d '\n')" || return 1
  [[ -n "$LEGACY_NORMAL_CONFIG_B64" ]]
}

assert_legacy_port_ownership() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local owners
  owners="$(docker ps --format '{{.ID}} {{.Ports}}' | awk '/0\.0\.0\.0:(80|443)->|\[::\]:(80|443)->/ {print $1}' | sort -u)"
  [[ "$owners" == "${LEGACY_WEB_ID:0:12}" || "$owners" == "$LEGACY_WEB_ID" ]]
}
legacy_scheduler_readiness() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  docker exec "$LEGACY_API_ID" node -e "fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal').then(async r=>{const b=await r.json();process.exit(r.ok&&b.ready===true&&b.scheduler&&b.scheduler.role==='leader'&&b.scheduler.databaseConnection==='connected'?0:1)}).catch(()=>process.exit(1))"
}
legacy_enable_maintenance() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_WEB_MAINTENANCE=1; return 0; }
  local caddy_path maintenance_config
  caddy_path="${LEGACY_CADDY_CONFIG_PATH:-$(legacy_caddy_config_path)}"
  maintenance_config="$(legacy_maintenance_config_path "$caddy_path")" || return 1
  [[ -f "$maintenance_config" ]] || return 1
  docker cp "$maintenance_config" "$LEGACY_WEB_ID:$caddy_path" || return 1
  docker exec "$LEGACY_WEB_ID" caddy reload --config "$caddy_path" --adapter caddyfile || return 1
  LEGACY_WEB_MAINTENANCE=1; maintenance_smoke
}
legacy_quarantine() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_API_QUARANTINED=1; LEGACY_WEB_QUARANTINED=1; return 0; }
  docker update --restart no "$LEGACY_API_ID" "$LEGACY_WEB_ID" >/dev/null || return 1
  LEGACY_API_QUARANTINED=1; LEGACY_WEB_QUARANTINED=1
}
legacy_stop() { [[ "$DRY_RUN" == 1 ]] && return 0; docker stop "$LEGACY_API_ID" >/dev/null; }
legacy_stop_web() {
  # A stopped legacy Web container remains attached to docker_default with its
  # 80/443 publication metadata. Remove it after its image and exact normal
  # Caddyfile have been captured so the fixed gateway becomes the sole port
  # owner. legacy_restore recreates it from the captured image on any failure.
  # Persist deletion authority first. If SIGKILL lands after `docker rm` but
  # before the completion save, reconcile can prove absence against a live
  # daemon and recreate the exact captured image instead of wedging forever.
  LEGACY_WEB_REMOVE_INTENT=1
  persist_legacy_cleanup_progress legacy-web-removal-intent || return 1
  if [[ "$DRY_RUN" == 1 ]]; then
    LEGACY_WEB_REMOVED=1
    persist_legacy_cleanup_progress legacy-web-removal-complete
    return
  fi
  docker stop "$LEGACY_WEB_ID" >/dev/null || return 1
  docker rm "$LEGACY_WEB_ID" >/dev/null 2>&1 \
    || legacy_container_absent "$LEGACY_WEB_ID" || return 1
  legacy_container_absent "$LEGACY_WEB_ID" || return 1
  LEGACY_WEB_REMOVED=1
  persist_legacy_cleanup_progress legacy-web-removal-complete
}
wait_host_ports_free() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local attempt
  for attempt in $(seq 1 30); do
    ! lsof -nP -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1 && ! lsof -nP -iTCP:443 -sTCP:LISTEN >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
wait_legacy_api() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local attempt
  for attempt in $(seq 1 "$READINESS_RETRIES"); do legacy_scheduler_readiness && return 0; sleep "$READINESS_INTERVAL"; done
  return 1
}
legacy_restore_normal_web_config() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_WEB_MAINTENANCE=0; return 0; }
  [[ -n "$LEGACY_NORMAL_CONFIG_B64" ]] || return 1
  local caddy_path
  caddy_path="${LEGACY_CADDY_CONFIG_PATH:-$(legacy_caddy_config_path)}"
  case "$caddy_path" in /srv/Caddyfile|/srv/Caddyfile.local|/srv/Caddyfile.production) ;; *) return 1 ;; esac
  printf '%s' "$LEGACY_NORMAL_CONFIG_B64" | base64 --decode | docker exec -i "$LEGACY_WEB_ID" sh -c "cat > '$caddy_path'" || return 1
  docker exec "$LEGACY_WEB_ID" caddy reload --config "$caddy_path" --adapter caddyfile || return 1
  LEGACY_WEB_MAINTENANCE=0
}

legacy_restore() {
  local rc=0
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_API_QUARANTINED=0; LEGACY_WEB_QUARANTINED=0; LEGACY_API_REMOVED=0; LEGACY_WEB_REMOVED=0; LEGACY_API_REMOVE_INTENT=0; LEGACY_WEB_REMOVE_INTENT=0; LEGACY_WEB_MAINTENANCE=0; return 0; }
  if ((LEGACY_API_REMOVE_INTENT == 1 && LEGACY_API_REMOVED == 0)); then
    [[ -n "$LEGACY_API_ID" ]] || return 1
    legacy_container_absent "$LEGACY_API_ID" && LEGACY_API_REMOVED=1 \
      || docker inspect "$LEGACY_API_ID" >/dev/null 2>&1 || return 1
  fi
  if ((LEGACY_WEB_REMOVE_INTENT == 1 && LEGACY_WEB_REMOVED == 0)); then
    [[ -n "$LEGACY_WEB_ID" ]] || return 1
    legacy_container_absent "$LEGACY_WEB_ID" && LEGACY_WEB_REMOVED=1 \
      || docker inspect "$LEGACY_WEB_ID" >/dev/null 2>&1 || return 1
  fi
  if ((LEGACY_API_REMOVED == 1 || LEGACY_WEB_REMOVED == 1)); then
    [[ -n "$LEGACY_API_IMAGE" && -n "$LEGACY_WEB_IMAGE" ]] || return 1
    if ((LEGACY_API_REMOVED == 1)); then
      legacy_compose_restore up -d --no-build --force-recreate api || rc=1
      LEGACY_API_ID="$(legacy_service_id api)"; [[ -n "$LEGACY_API_ID" ]] || rc=1
      ((rc != 0)) || LEGACY_API_REMOVED=0
    fi
    if ((LEGACY_WEB_REMOVED == 1)); then
      legacy_compose_restore up -d --no-build --force-recreate web || rc=1
      LEGACY_WEB_ID="$(legacy_service_id web)"; [[ -n "$LEGACY_WEB_ID" ]] || rc=1
      ((rc != 0)) || LEGACY_WEB_REMOVED=0
    fi
  fi
  [[ -n "$LEGACY_API_ID" && -n "$LEGACY_WEB_ID" ]] || return 1
  docker update --restart "${LEGACY_API_RESTART:-always}" "$LEGACY_API_ID" >/dev/null || rc=1
  docker update --restart "${LEGACY_WEB_RESTART:-always}" "$LEGACY_WEB_ID" >/dev/null || rc=1
  if ((LEGACY_API_WAS_RUNNING == 1)); then docker_running "$LEGACY_API_ID" || docker start "$LEGACY_API_ID" >/dev/null || rc=1; wait_legacy_api || rc=1; fi
  if ((LEGACY_WEB_WAS_RUNNING == 1)); then docker_running "$LEGACY_WEB_ID" || docker start "$LEGACY_WEB_ID" >/dev/null || rc=1; legacy_restore_normal_web_config || rc=1; fi
  if ((rc == 0)); then
    LEGACY_API_QUARANTINED=0; LEGACY_WEB_QUARANTINED=0
    LEGACY_API_REMOVE_INTENT=0; LEGACY_WEB_REMOVE_INTENT=0
    LEGACY_WEB_MAINTENANCE=0
  fi
  return "$rc"
}

legacy_enforce_quarantine() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  ((LEGACY_API_REMOVED == 1)) || { [[ -n "$LEGACY_API_ID" ]] && docker update --restart no "$LEGACY_API_ID" >/dev/null && docker stop "$LEGACY_API_ID" >/dev/null 2>&1 || true; }
  ((LEGACY_WEB_REMOVED == 1)) || { [[ -n "$LEGACY_WEB_ID" ]] && docker update --restart no "$LEGACY_WEB_ID" >/dev/null && docker stop "$LEGACY_WEB_ID" >/dev/null 2>&1 || true; }
  LEGACY_API_QUARANTINED=1; LEGACY_WEB_QUARANTINED=1
}
phase3_stop_for_recovery() { compose_current stop api-blue web-blue api-green web-green gateway >/dev/null 2>&1 || return 1; }

restore_legacy_after_phase3_stop() {
  # Legacy Web and the Phase 3 gateway both publish 80/443. Stop the gateway
  # before attempting a legacy restore; if restore fails, re-establish gateway
  # maintenance rather than leaving the host without a listener.
  if ! phase3_stop_for_recovery; then
    alert CRITICAL 'could not stop Phase 3 before legacy restore; retaining gateway maintenance where possible'
    ensure_gateway_maintenance || alert CRITICAL 'gateway maintenance could not be re-established after failed Phase 3 stop'
    return 1
  fi
  if legacy_restore; then
    return 0
  fi
  alert CRITICAL 'legacy restore failed after Phase 3 stop; retaining gateway maintenance page'
  ensure_gateway_maintenance || alert CRITICAL 'gateway maintenance page could not be proven after legacy restore failure'
  return 1
}

migration_applied_checksums() {
  local candidate="$1"
  compose_current run --rm --no-deps "api-${candidate}" sh -lc \
    'PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -AtF "|" -c "SELECT migration_name, checksum FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"'
}

# Hidden, read-only observation used by the coordinator's fleet evidence path.
# It deliberately requires a normalized live release and queries the active API
# container instead of trusting migration files from the mutable checkout.
live_migration_ledger() {
  [[ "$DRY_RUN" != 1 ]] || die 'live migration evidence is unavailable in dry-run mode'
  require_active_state
  [[ -z "$CANDIDATE_SLOT" && -z "$PREVIOUS_SLOT" && -z "$STABLE_UNTIL" \
    && -z "$MONITOR_ACTIVE_SLOT" && -z "$MONITOR_ROLLBACK_SLOT" ]] \
    || die 'live migration evidence requires normalized Blue/Green state'
  [[ "$GATEWAY_MODE" == application && "$GATEWAY_SLOT" == "$ACTIVE_SLOT" ]] \
    || die 'live migration evidence requires the active application gateway'
  verify_slot_identity "$ACTIVE_SLOT" \
    || die 'live migration evidence requires the sealed active slot'
  slot_runtime_ready "$ACTIVE_SLOT" leader \
    || die 'live migration evidence requires a healthy scheduler leader'
  local container
  container="$(slot_container_id "api-${ACTIVE_SLOT}")"
  [[ -n "$container" ]] || die 'active API container is unavailable for migration evidence'
  docker exec "$container" sh -lc \
    'PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -AtF "|" -c "SELECT migration_name, checksum FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"' \
    || die 'could not read the live applied Prisma migration ledger'
}

verify_migration_plan() {
  local candidate="$1" base_image="$2" candidate_image candidate_ref base_ref ledger plan_data
  candidate_image="$(slot_api_image "$candidate")"
  if [[ "$DRY_RUN" == 1 && "${PI5_BLUE_GREEN_TEST_ALLOW_MISSING_RELEASE_EVIDENCE:-0}" == 1 ]]; then
    MIGRATION_CANDIDATE_COMMIT="$(image_commit "$candidate_image" 2>/dev/null || true)"
    MIGRATION_BASE_COMMIT="$MIGRATION_CANDIDATE_COMMIT"
    MIGRATION_STATUS=checked
    MIGRATION_CHECKED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    MIGRATION_APPLIED_AT=''
    return 0
  fi
  [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] || die '--run-id is required for migration verification'
  [[ -n "$MIGRATION_PLAN_FILE" ]] || die '--migration-plan is required for migration verification'
  candidate_ref="$(image_commit "$candidate_image")" || die 'candidate image tag is not an immutable commit/config tag'
  base_ref="$(image_commit "$base_image")" || die 'live compatibility image is not bound to an immutable base commit'
  ledger="$(mktemp "${TMPDIR:-/tmp}/pi5-blue-green-ledger.XXXXXX")"
  chmod 600 "$ledger"
  if ! migration_applied_checksums "$candidate" >"$ledger"; then
    rm -f "$ledger"
    die 'could not re-read the applied migration ledger'
  fi
  if ! plan_data="$(python3 "$RELEASE_EVIDENCE_HELPER" verify-migration \
    --path "$MIGRATION_PLAN_FILE" --run-id "$RUN_ID" --sha "$candidate_ref" --ledger "$ledger")"; then
    rm -f "$ledger"
    die 'migration plan is stale, tampered, or the applied ledger changed'
  fi
  rm -f "$ledger"
  MIGRATION_BASE_COMMIT="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["baseSha"])' <<<"$plan_data")"
  [[ "$MIGRATION_BASE_COMMIT" == "$base_ref" ]] \
    || die 'migration plan base no longer matches the live compatibility image'
  MIGRATION_CANDIDATE_COMMIT="$candidate_ref"
  MIGRATION_STATUS=checked; MIGRATION_CHECKED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"; MIGRATION_APPLIED_AT=''
}

migration_apply_and_verify() {
  local candidate="$1" base_image="$2" compatibility_slot="$3"
  local applied_ledger
  verify_migration_plan "$candidate" "$base_image" || return 1
  if [[ "$DRY_RUN" != 1 ]]; then
    # The API image has `node dist/main.js` as its default command.  Use an
    # explicit shell and the installed Prisma binary so Compose does not try to
    # execute `npx` through that Node command during bootstrap/prepare.
    compose_current run --rm --no-deps "api-${candidate}" sh -lc './node_modules/.bin/prisma migrate deploy' || return 1
    compose_current run --rm --no-deps "api-${candidate}" sh -lc './node_modules/.bin/prisma migrate status' || return 1
    applied_ledger="$(mktemp "${TMPDIR:-/tmp}/pi5-blue-green-applied.XXXXXX")" || return 1
    chmod 600 "$applied_ledger"
    if ! migration_applied_checksums "$candidate" >"$applied_ledger" \
      || ! migration_gate_verify_applied_ledger \
        "$PROJECT_DIR" "$MIGRATION_BASE_COMMIT" "$MIGRATION_CANDIDATE_COMMIT" "$applied_ledger"; then
      rm -f "$applied_ledger"
      return 1
    fi
    rm -f "$applied_ledger"
    if [[ "$compatibility_slot" == legacy ]]; then legacy_scheduler_readiness || return 1
    else slot_runtime_ready "$compatibility_slot" leader || return 1
    fi
  fi
  MIGRATION_STATUS=applied; MIGRATION_APPLIED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
}

assert_running_slot_images_match_state() {
  local slot api_cid web_cid
  [[ "$DRY_RUN" == 1 ]] && return 0
  for slot in blue green; do
    api_cid="$(slot_container_id "api-${slot}")"; web_cid="$(slot_container_id "web-${slot}")"
    if [[ -n "$api_cid" || -n "$web_cid" ]]; then
      [[ -n "$(slot_api_image "$slot")" && -n "$(slot_web_image "$slot")" ]] || die "running ${slot} containers exist but state has incomplete images; refusing compose up"
      verify_slot_identity "$slot" || die "running ${slot} images do not match Blue/Green state; refusing compose up (possible rewritten state)"
    fi
  done
}

assert_slot_state_images_trusted() {
  local slot api_image web_image api_id web_id
  for slot in "$@"; do
    is_slot "$slot" || die "invalid state slot while validating images: ${slot}"
    api_image="$(slot_api_image "$slot")"; web_image="$(slot_web_image "$slot")"
    [[ -n "$api_image" && -n "$web_image" ]] || die "state has incomplete ${slot} image pair; refusing compose up"
    validate_image_pair "$api_image" "$web_image"
    if [[ "$DRY_RUN" != 1 ]]; then
      api_id="$(slot_api_image_id "$slot")"; web_id="$(slot_web_image_id "$slot")"
      [[ "$api_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || die "state has no sealed ${slot} image IDs; refusing compose up"
      [[ "$(docker image inspect -f '{{.Id}}' "$api_image" 2>/dev/null || true)" == "$api_id" \
        && "$(docker image inspect -f '{{.Id}}' "$web_image" 2>/dev/null || true)" == "$web_id" ]] \
        || die "state image tag was retargeted for ${slot}; refusing compose up"
    fi
  done
}

arm_bootstrap_recovery() {
  BOOTSTRAP_RECOVERY_ARMED=1
  trap 'rc=$?; if ((BOOTSTRAP_RECOVERY_ARMED==1)); then bootstrap_failure "unexpected bootstrap exit (${rc})"; fi' ERR
  trap 'if ((BOOTSTRAP_RECOVERY_ARMED==1)); then bootstrap_failure "bootstrap interrupted by signal"; fi' INT TERM HUP
}
disarm_bootstrap_recovery() { BOOTSTRAP_RECOVERY_ARMED=0; trap - ERR INT TERM HUP; }

arm_prepare_recovery() {
  PREPARE_RECOVERY_ARMED=1
  trap 'rc=$?; if ((PREPARE_RECOVERY_ARMED==1)); then prepare_failure "unexpected prepare exit (${rc})"; fi' ERR
  trap 'if ((PREPARE_RECOVERY_ARMED==1)); then prepare_failure "prepare interrupted by signal"; fi' INT TERM HUP
}
disarm_prepare_recovery() { PREPARE_RECOVERY_ARMED=0; trap - ERR INT TERM HUP; }

prepare_failure() {
  local reason="$1"
  trap - ERR EXIT INT TERM HUP; PREPARE_RECOVERY_ARMED=0; set +e
  alert ERROR "Blue/Green candidate preparation failed: ${reason}; durable candidate cleanup is required"
  state_save prepare-failed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' "$reason" prepare-failed || true
  lock_cleanup; set -e; die "candidate prepare failed: $reason"
}

bootstrap_failure() {
  local reason="$1" restored=0 gateway_mode=offline
  trap - ERR EXIT INT TERM HUP; BOOTSTRAP_RECOVERY_ARMED=0; set +e
  alert CRITICAL "Blue/Green bootstrap failed: ${reason}; restoring legacy API/Web"
  if restore_legacy_after_phase3_stop; then
    restored=1
    alert WARNING 'legacy API/Web restoration completed after bootstrap failure'
  else
    gateway_mode=maintenance
  fi
  state_save bootstrap-failed '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    "$gateway_mode" '' '' '' '' "$reason" "legacy-restored=${restored}" || true
  lock_cleanup; set -e; die "bootstrap failed: $reason"
}

require_active_state() { load_state_context; is_slot "$ACTIVE_SLOT" || die 'active slot is missing'; }
require_no_stability_window() {
  if [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -lt STABLE_UNTIL ]]; then die 'stability window is active; rollback or wait before prepare'; fi
}

bootstrap() {
  ((CONFIRM_BOOTSTRAP == 1)) || die 'first bootstrap requires --confirm-bootstrap'
  ((ALLOW_LEGACY_HANDOFF == 1)) || die 'first bootstrap requires --allow-legacy-scheduler-handoff'
  if [[ -f "$STATE_FILE" ]]; then
    state_assert
    [[ "$(state_get event)" == bootstrap-failed || "$(state_get event)" == legacy-restored ]] \
      || die 'Blue/Green state already exists; use reconcile or status'
  fi
  resolve_images; validate_resource_evidence; secret_guard
  BLUE_API_IMAGE="$API_IMAGE"; BLUE_WEB_IMAGE="$WEB_IMAGE"; GREEN_API_IMAGE=''; GREEN_WEB_IMAGE=''
  BLUE_API_IMAGE_ID="$CANDIDATE_API_IMAGE_ID"; BLUE_WEB_IMAGE_ID="$CANDIDATE_WEB_IMAGE_ID"
  GREEN_API_IMAGE_ID=''; GREEN_WEB_IMAGE_ID=''
  ACTIVE_SLOT=''; CANDIDATE_SLOT=blue; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''
  legacy_capture || die 'legacy API/Web containers are missing; bootstrap refused'
  ((LEGACY_API_WAS_RUNNING == 1 && LEGACY_WEB_WAS_RUNNING == 1)) || die 'legacy API/Web must both be running before bootstrap'
  assert_legacy_port_ownership || die '80/443 are not owned exclusively by legacy Web'
  legacy_scheduler_readiness || die 'legacy API is not a healthy scheduler leader'
  MIGRATION_BASE_COMMIT=''; MIGRATION_CANDIDATE_COMMIT=''; MIGRATION_STATUS=not-checked
  MIGRATION_CHECKED_AT=''; MIGRATION_APPLIED_AT=''
  # Seal recovery authority before migration or any inactive-slot container is
  # started. SIGKILL cannot run traps, so takeover must be state-driven.
  state_save bootstrap-preparing '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' \
    offline '' '' '' '' '' bootstrap-recovery-authority-sealed
  arm_bootstrap_recovery
  render_gateway maintenance || bootstrap_failure 'gateway maintenance configuration could not be rendered'
  gateway_config_validate || bootstrap_failure 'gateway maintenance configuration is invalid'
  migration_apply_and_verify blue "$LEGACY_API_IMAGE" legacy \
    || { MIGRATION_STATUS=failed; bootstrap_failure 'candidate migration or compatibility failed'; }
  slot_up blue standby \
    || { phase3_stop_for_recovery || true; bootstrap_failure 'Blue candidate did not become scheduler standby'; }
  GATEWAY_MODE=maintenance; GATEWAY_SLOT=''
  state_save bootstrapping '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' maintenance '' '' '' '' '' preflight-complete
  legacy_enable_maintenance || bootstrap_failure 'legacy Web maintenance page did not become reachable'
  state_save bootstrapping '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' maintenance '' '' '' '' '' legacy-maintenance-verified
  legacy_quarantine || bootstrap_failure 'failed to quarantine legacy restart policies'
  state_save bootstrapping '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' maintenance '' '' '' '' '' legacy-quarantined
  legacy_stop || bootstrap_failure 'legacy API did not stop'
  scheduler_readiness blue leader || bootstrap_failure 'Blue API did not become scheduler leader after legacy stop'
  legacy_stop_web || bootstrap_failure 'legacy Web did not stop'; wait_host_ports_free || bootstrap_failure 'legacy Web did not release 80/443'
  gateway_start || bootstrap_failure 'gateway did not start'; maintenance_smoke || bootstrap_failure 'gateway maintenance page failed smoke'
  render_gateway application blue; gateway_config_validate; gateway_reload || bootstrap_failure 'gateway application reload failed'
  gateway_points_to blue && external_smoke || bootstrap_failure 'gateway application activation smoke failed'
  GATEWAY_MODE=application; GATEWAY_SLOT=blue
  state_save active blue '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' application blue '' '' '' '' bootstrap-success
  disarm_bootstrap_recovery
  log 'Blue/Green bootstrap completed; blue is active and legacy services are quarantined'
}

prepare() {
  require_active_state; require_no_stability_window
  cleanup_retired_images \
    || die 'previous run-scoped image retirement is incomplete; refusing another candidate'
  secret_guard; resolve_images; validate_resource_evidence
  seal_active_slot_image_ids
  verify_slot_identity "$ACTIVE_SLOT" || die 'active slot image does not match state; run reconcile'
  slot_runtime_ready "$ACTIVE_SLOT" leader || die 'active slot is not a healthy scheduler leader'
  local candidate displaced_api displaced_web displaced_api_id displaced_web_id
  candidate="$(other_slot "$ACTIVE_SLOT")"
  displaced_api="$(slot_api_image "$candidate")"
  displaced_web="$(slot_web_image "$candidate")"
  displaced_api_id="$(slot_api_image_id "$candidate")"
  displaced_web_id="$(slot_web_image_id "$candidate")"
  if [[ "$candidate" == blue ]]; then
    BLUE_API_IMAGE="$API_IMAGE"; BLUE_WEB_IMAGE="$WEB_IMAGE"
  else
    GREEN_API_IMAGE="$API_IMAGE"; GREEN_WEB_IMAGE="$WEB_IMAGE"
  fi
  set_slot_image_ids "$candidate" "$CANDIDATE_API_IMAGE_ID" "$CANDIDATE_WEB_IMAGE_ID"
  if [[ -n "$displaced_api" || -n "$displaced_web" \
    || -n "$displaced_api_id" || -n "$displaced_web_id" ]]; then
    if run_scoped_image_tag "$displaced_api" \
      || run_scoped_image_tag "$displaced_web"; then
      run_scoped_image_tag "$displaced_api" \
        && run_scoped_image_tag "$displaced_web" \
        && [[ "$displaced_api_id" =~ ^sha256:[0-9a-f]{64}$ \
          && "$displaced_web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || die 'displaced run-scoped image ownership is incomplete'
      if [[ "$displaced_api" == "$API_IMAGE" || "$displaced_web" == "$WEB_IMAGE" ]]; then
        [[ "$displaced_api" == "$API_IMAGE" && "$displaced_web" == "$WEB_IMAGE" \
          && "$displaced_api_id" == "$CANDIDATE_API_IMAGE_ID" \
          && "$displaced_web_id" == "$CANDIDATE_WEB_IMAGE_ID" ]] \
          || die 'candidate would retarget a durable run-scoped slot tag'
      else
        RETIRED_API_IMAGE="$displaced_api"; RETIRED_WEB_IMAGE="$displaced_web"
        RETIRED_API_IMAGE_ID="$displaced_api_id"; RETIRED_WEB_IMAGE_ID="$displaced_web_id"
      fi
    fi
  fi
  CANDIDATE_SLOT="$candidate"
  MIGRATION_BASE_COMMIT=''; MIGRATION_CANDIDATE_COMMIT=''; MIGRATION_STATUS=not-checked
  MIGRATION_CHECKED_AT=''; MIGRATION_APPLIED_AT=''
  # Candidate identity and cleanup authority become durable before the first
  # migration command or Compose start. A crash can therefore be taken over
  # without guessing which inactive workload belongs to this release.
  state_save preparing "$ACTIVE_SLOT" "$CANDIDATE_SLOT" '' \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' '' prepare-recovery-authority-sealed
  arm_prepare_recovery
  cleanup_retired_images \
    || prepare_failure 'displaced run-scoped image tags remain referenced or unverifiable'
  migration_apply_and_verify "$candidate" "$(slot_api_image "$ACTIVE_SLOT")" "$ACTIVE_SLOT" \
    || { MIGRATION_STATUS=failed; prepare_failure 'candidate migration or compatibility failed'; }
  slot_up "$candidate" standby \
    || prepare_failure "candidate ${candidate} is not a healthy scheduler standby"
  state_save prepared "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' candidate-prepared
  disarm_prepare_recovery
  log "candidate prepared in ${candidate} slot"
}

rollback_internal() {
  local target="$1" failed="$2" reason="$3"
  is_slot "$target" && is_slot "$failed" || return 1
  verify_slot_identity "$target" || return 1
  slot_runtime_ready "$target" leader || return 1
  render_gateway application "$target" || return 1
  gateway_config_validate && gateway_reload && gateway_points_to "$target" && external_smoke || return 1
  ACTIVE_SLOT="$target"; CANDIDATE_SLOT="$failed"; PREVIOUS_SLOT="$failed"
  GATEWAY_MODE=application; GATEWAY_SLOT="$target"; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  state_save rolled-back "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$target" '' '' '' "$reason" rollback-success || return 1
  log "rollback completed: ${reason}"
}

switch_candidate() {
  require_active_state
  local candidate="$CANDIDATE_SLOT" previous="$ACTIVE_SLOT" started now stable
  is_slot "$candidate" || die 'candidate slot is missing; run prepare'
  [[ "$candidate" != "$previous" ]] || die 'candidate is already active'
  verify_durable_release_evidence "$candidate" \
    || die 'candidate release evidence changed or expired before traffic switch'
  verify_slot_identity "$previous" && verify_slot_identity "$candidate" || die 'slot images do not match durable state'
  slot_runtime_ready "$previous" leader || die 'previous slot is not scheduler leader'
  slot_ready "$candidate" standby || die 'candidate is not scheduler standby'
  started="$(date +%s)"
  state_save switching "$previous" "$candidate" "$previous" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$previous" '' '' '' '' switching
  if ! render_gateway application "$candidate" \
    || ! gateway_config_validate \
    || ! gateway_reload \
    || ! gateway_points_to "$candidate" \
    || ! external_smoke; then
    state_save switch-failed "$previous" "$candidate" "$previous" \
      "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
      application "$previous" '' '' '' 'gateway or external smoke failed' switchback-required \
      || alert CRITICAL 'switch failed and failure evidence could not be persisted'
    die 'switch failed; coordinator switchback is required'
  fi
  now="$(date +%s)"; stable=$((now + STABLE_SECONDS))
  ACTIVE_SLOT="$candidate"; CANDIDATE_SLOT="$previous"; PREVIOUS_SLOT="$previous"
  STABLE_UNTIL="$stable"; MONITOR_ACTIVE_SLOT="$candidate"; MONITOR_ROLLBACK_SLOT="$previous"; GATEWAY_SLOT="$candidate"
  if ! state_save active "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" '' "success:$((now-started))s"; then
    alert CRITICAL 'gateway switched but durable state save failed; coordinator switchback is required'
    die 'switch failed after gateway cutover because durable state could not be saved; coordinator switchback is required'
  fi
  log "switch completed; ${candidate} is public standby and ${previous} remains scheduler leader until ${stable}"
}

rollback() {
  require_active_state
  local event target failed
  event="$(state_get event)"
  [[ "$event" != cleanup-handoff ]] \
    || die 'scheduler handoff is committed; only idempotent cleanup may continue'
  if [[ "$event" == switching || "$event" == switch-failed ]]; then
    target="$ACTIVE_SLOT"
    failed="$CANDIDATE_SLOT"
    [[ "$PREVIOUS_SLOT" == "$target" ]] || die 'switchback authority is malformed'
  else
    target="$PREVIOUS_SLOT"
    failed="$ACTIVE_SLOT"
  fi
  is_slot "$target" && is_slot "$failed" && [[ "$target" != "$failed" ]] \
    || die 'no complete switchback authority is recorded'
  rollback_internal "$target" "$failed" "${ROLLBACK_REASON:-coordinator runtime switchback}" \
    || { alert CRITICAL 'coordinator-requested switchback failed; routing left unchanged'; die 'runtime switchback failed'; }
}

monitor_checks() {
  local active="$1" rollback_slot="$2" samples="$3" force_structural="${4:-0}" error_rate
  if ((force_structural == 1 || samples == 1 || (samples - 1) % MONITOR_STRUCTURAL_SAMPLE_INTERVAL == 0)); then
    if ((STRUCTURAL_ONLY == 1)); then
      slot_structural_ready "$active" standby || return 1
    else
      slot_ready "$active" standby || return 1
    fi
    slot_runtime_ready "$rollback_slot" leader || return 1
  else
    # Scheduler/database readiness and the public API/Web path are still
    # checked every two seconds. Only immutable structure checks are amortized.
    scheduler_readiness "$active" standby || return 1
    scheduler_readiness "$rollback_slot" leader || return 1
  fi
  external_smoke || return 1
  if [[ -n "$ERROR_RATE_URL" && "$samples" -ge "$MIN_ERROR_SAMPLES" && "$DRY_RUN" != 1 ]]; then
    error_rate="$(curl -kfsS --max-time 5 "$ERROR_RATE_URL" | python3 -c '
import json, math, sys
def pairs(items):
    result={}
    for key,value in items:
        if key in result: raise ValueError("duplicate JSON key")
        result[key]=value
    return result
d=json.load(sys.stdin, object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
value=d.get("errorRate",d.get("error_rate")) if isinstance(d,dict) else None
if type(value) not in (int,float) or not math.isfinite(value) or not 0 <= value <= 1: raise SystemExit(1)
print(value)
')" || return 1
    awk "BEGIN {exit !($error_rate <= $MAX_ERROR_RATE)}" || return 1
  fi
}

monitor() {
  [[ -f "$STATE_FILE" ]] || return 0
  local deadline active rollback_slot event samples=0 now
  while :; do
    load_state_context
    event="$(state_get event)"
    case "$event" in
      active|reconciled) ;;
      monitor-passed) return 0 ;;
      monitor-failed) return 1 ;;
      *) return 1 ;;
    esac
    deadline="$STABLE_UNTIL"; active="$MONITOR_ACTIVE_SLOT"; rollback_slot="$MONITOR_ROLLBACK_SLOT"
    [[ "$deadline" =~ ^[0-9]+$ ]] || return 0
    is_slot "$active" && is_slot "$rollback_slot" || return 0
    now="$(date +%s)"
    if ((now >= deadline)); then
      samples=$((samples + 1))
      if ! monitor_checks "$active" "$rollback_slot" "$samples" 1; then
        alert CRITICAL "stability monitor failed for ${active}; coordinator switchback is required"
        state_save monitor-failed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
          "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
          application "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" \
          'stability monitor final sample failure' switchback-required \
          || alert CRITICAL 'monitor failure evidence could not be persisted'
        return 1
      fi
      state_save monitor-passed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
        "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
        application "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" \
        '' stability-monitor-complete
      return 0
    fi
    samples=$((samples + 1))
    if ! monitor_checks "$active" "$rollback_slot" "$samples"; then
      alert CRITICAL "stability monitor failed for ${active}; coordinator switchback is required"
      state_save monitor-failed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
        "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
        application "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" \
        'stability monitor threshold failure' switchback-required \
        || alert CRITICAL 'monitor failure evidence could not be persisted'
      return 1
    fi
    sleep "$MONITOR_INTERVAL"
  done
}

# A coordinator takeover cannot count an interval in which its monitor was not
# known to be alive. Restart a complete five-minute window, durably, before the
# recovery coordinator invokes `monitor` synchronously.
restart_stability_window() {
  ((STRUCTURAL_ONLY == 1)) \
    || die 'stability monitor restart is reserved for coordinator recovery'
  require_active_state
  local event previous stable
  event="$(state_get event)"; previous="$PREVIOUS_SLOT"
  [[ "$event" == active || "$event" == reconciled ]] \
    || die 'only an interrupted active stability window can be restarted'
  is_slot "$previous" && [[ "$previous" != "$ACTIVE_SLOT" \
    && "$CANDIDATE_SLOT" == "$previous" \
    && "$MONITOR_ACTIVE_SLOT" == "$ACTIVE_SLOT" \
    && "$MONITOR_ROLLBACK_SLOT" == "$previous" ]] \
    || die 'interrupted stability window state is malformed'
  [[ "$GATEWAY_MODE" == application && "$GATEWAY_SLOT" == "$ACTIVE_SLOT" ]] \
    || die 'interrupted stability window gateway is malformed'
  slot_structural_ready "$ACTIVE_SLOT" standby \
    || die 'active candidate is not a healthy standby during monitor takeover'
  slot_runtime_ready "$previous" leader \
    || die 'previous scheduler leader is unhealthy during monitor takeover'
  external_smoke || die 'public smoke failed during monitor takeover'
  stable=$(($(date +%s) + STABLE_SECONDS))
  STABLE_UNTIL="$stable"
  state_save active "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" \
    "$MONITOR_ROLLBACK_SLOT" '' recovery-stability-window-restarted
  log "restarted continuous stability monitor until ${stable}"
}

spawn_stability_monitor() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ ]] || return 0
  (( $(date +%s) < STABLE_UNTIL )) || return 0
  is_slot "$MONITOR_ACTIVE_SLOT" && is_slot "$MONITOR_ROLLBACK_SLOT" || return 0
  nohup sh -c "sleep 1; exec '$SCRIPT_PATH' monitor" >>"${STATE_FILE}.monitor.log" 2>&1 &
  log "stability monitor (re)started until ${STABLE_UNTIL}"
}

legacy_container_absent() {
  local container="$1"
  if docker inspect "$container" >/dev/null 2>&1; then
    return 1
  fi
  # `inspect` also fails when the daemon is unavailable. Prove the daemon is
  # responsive before classifying a missing immutable container ID as already
  # removed after a crash.
  docker info >/dev/null 2>&1
}

persist_legacy_cleanup_progress() {
  local result="$1" event reason
  event="$(state_get event)"; reason="$(state_get rollbackReason)"
  [[ -n "$event" ]] || return 1
  state_save "$event" "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    "$GATEWAY_MODE" "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" \
    "$MONITOR_ROLLBACK_SLOT" "$reason" "$result"
}

remove_legacy_container_once() {
  local kind="$1" container removed result
  case "$kind" in
    api) container="$LEGACY_API_ID"; removed="$LEGACY_API_REMOVED" ;;
    web) container="$LEGACY_WEB_ID"; removed="$LEGACY_WEB_REMOVED" ;;
    *) return 2 ;;
  esac
  ((removed == 0)) || return 0
  [[ -n "$container" ]] || return 1

  if ! legacy_container_absent "$container"; then
    # A daemon disconnect can lose the successful `rm` response. Resolve the
    # boundary from live absence instead of wedging on the command result.
    docker rm "$container" >/dev/null 2>&1 || legacy_container_absent "$container" || return 1
    legacy_container_absent "$container" || return 1
  fi
  if [[ "$kind" == api ]]; then LEGACY_API_REMOVED=1
  else LEGACY_WEB_REMOVED=1
  fi
  result="legacy-${kind}-cleanup-complete"
  persist_legacy_cleanup_progress "$result"
}

cleanup_legacy() {
  if [[ "$DRY_RUN" == 1 ]]; then
    LEGACY_API_REMOVED=1; LEGACY_WEB_REMOVED=1
    return 0
  fi
  # Stop at the first unpersisted boundary. A retry treats a missing container
  # ID as the already-completed removal, then durably records it before moving
  # to the next service.
  remove_legacy_container_once api || return 1
  remove_legacy_container_once web
}

# Persist the cleanup transaction before stopping the previous scheduler
# leader. The same transaction can then resume after a crash at any subsequent
# stop/rm/state-save boundary without pretending the removed slot is still a
# rollback target.
cleanup_previous_slot_transaction() {
  local previous="$1" event previous_web
  event="$(state_get event)"
  if [[ "$event" != cleanup-handoff ]]; then
    CANDIDATE_SLOT="$previous"; PREVIOUS_SLOT="$previous"
    STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
    state_save cleanup-handoff "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
      "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
      application "$ACTIVE_SLOT" '' '' '' '' cleanup-handoff-started || return 1
  else
    [[ "$CANDIDATE_SLOT" == "$previous" && "$PREVIOUS_SLOT" == "$previous" \
      && -z "$STABLE_UNTIL" && -z "$MONITOR_ACTIVE_SLOT" && -z "$MONITOR_ROLLBACK_SLOT" ]] \
      || return 1
  fi

  if verify_slot_identity "$previous" && scheduler_readiness "$previous" leader; then
    if ((STRUCTURAL_ONLY == 1)); then
      slot_structural_ready "$ACTIVE_SLOT" standby || return 1
    else
      slot_ready "$ACTIVE_SLOT" standby || return 1
    fi
    compose_current stop "api-${previous}" || return 1
    if ! slot_runtime_ready "$ACTIVE_SLOT" leader; then
      compose_current up -d "api-${previous}" >/dev/null 2>&1 || true
      slot_runtime_ready "$previous" leader \
        || alert CRITICAL 'new leader failed and previous scheduler leader could not be restored'
      return 1
    fi
  else
    # A prior attempt may already have stopped/removed the old API. In that
    # case only a fully healthy active leader grants authority to continue.
    if ((STRUCTURAL_ONLY == 1)); then
      slot_structural_ready "$ACTIVE_SLOT" leader || return 1
    else
      slot_ready "$ACTIVE_SLOT" leader || return 1
    fi
  fi

  verify_present_slot_identity "$previous" || return 1
  state_save cleanup-handoff "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' '' cleanup-leader-handoff-complete || return 1

  previous_web="$(slot_container_id "web-${previous}")"
  [[ -z "$previous_web" ]] || compose_current stop "web-${previous}" || return 1
  compose_current rm -f "api-${previous}" "web-${previous}" || return 1
  [[ -z "$(slot_any_container_id "api-${previous}")" \
    && -z "$(slot_any_container_id "web-${previous}")" ]] || return 1

  if ! cleanup_legacy; then
    alert ERROR 'legacy cleanup was partial; cleanup handoff remains resumable'
    state_save cleanup-handoff "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
      "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
      application "$ACTIVE_SLOT" '' '' '' '' legacy-cleanup-partial || true
    return 1
  fi

  PREVIOUS_SLOT=''; CANDIDATE_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  state_save cleaned "$ACTIVE_SLOT" '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" \
    "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' cleanup-complete
}

discard_prepared_candidate() {
  local candidate="$CANDIDATE_SLOT" kind service
  is_slot "$ACTIVE_SLOT" && is_slot "$candidate" && [[ "$candidate" != "$ACTIVE_SLOT" \
    && -z "$PREVIOUS_SLOT" && -z "$STABLE_UNTIL" \
    && -z "$MONITOR_ACTIVE_SLOT" && -z "$MONITOR_ROLLBACK_SLOT" ]] \
    || return 1
  [[ "$GATEWAY_MODE" == application && "$GATEWAY_SLOT" == "$ACTIVE_SLOT" ]] \
    || return 1
  if ((STRUCTURAL_ONLY == 1)); then
    slot_structural_ready "$ACTIVE_SLOT" leader || return 1
  else
    slot_ready "$ACTIVE_SLOT" leader || return 1
  fi
  verify_present_slot_identity "$candidate" || return 1
  for kind in api web; do
    service="${kind}-${candidate}"
    [[ -z "$(slot_container_id "$service")" ]] \
      || compose_current stop "$service" || return 1
    [[ -z "$(slot_any_container_id "$service")" ]] \
      || compose_current rm -f "$service" || return 1
  done
  [[ -z "$(slot_any_container_id "api-${candidate}")" \
    && -z "$(slot_any_container_id "web-${candidate}")" ]] || return 1
  CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  state_save candidate-discarded "$ACTIVE_SLOT" '' '' \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' '' prepared-candidate-discarded
}

cleanup() {
  require_active_state
  cleanup_retired_images \
    || die 'run-scoped image retirement is incomplete but remains resumable'
  local now previous event; now="$(date +%s)"; previous="$PREVIOUS_SLOT"; event="$(state_get event)"
  case "$event" in
    preparing|prepare-failed|prepared|candidate-prepared)
      discard_prepared_candidate \
        || die 'prepared candidate cleanup is incomplete but remains resumable'
      log 'discarded prepared candidate; active slot remains unchanged'
      return 0
      ;;
    switching|switch-failed|monitor-failed)
      die 'coordinator switchback is required before cleanup'
      ;;
    rolled-back)
      is_slot "$previous" && [[ "$previous" != "$ACTIVE_SLOT" ]] \
        || die 'rolled-back state has no failed slot to clean'
      slot_runtime_ready "$ACTIVE_SLOT" leader || die 'restored slot is not leader before rollback cleanup'
      verify_present_slot_identity "$previous" || die 'failed slot identity is unknown; refusing rollback cleanup'
      [[ -z "$(slot_container_id "api-${previous}")" ]] \
        || compose_current stop "api-${previous}" || die 'could not stop failed API after switchback'
      [[ -z "$(slot_container_id "web-${previous}")" ]] \
        || compose_current stop "web-${previous}" || die 'could not stop failed Web after switchback'
      compose_current rm -f "api-${previous}" "web-${previous}" || die 'could not remove failed slot after switchback'
      [[ -z "$(slot_any_container_id "api-${previous}")" \
        && -z "$(slot_any_container_id "web-${previous}")" ]] \
        || die 'failed slot containers remain after rollback cleanup'
      if ! cleanup_legacy; then
        state_save rolled-back "$ACTIVE_SLOT" "$previous" "$previous" \
          "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
          application "$ACTIVE_SLOT" '' '' '' '' rollback-legacy-cleanup-partial || true
        die 'legacy cleanup was partial after switchback; rollback cleanup remains resumable'
      fi
      PREVIOUS_SLOT=''; CANDIDATE_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
      state_save rollback-cleaned "$ACTIVE_SLOT" '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' rollback-cleanup-complete
      log "rollback cleanup completed; ${ACTIVE_SLOT} remains scheduler leader"
      return 0
      ;;
  esac
  is_slot "$previous" || { log 'no previous slot to clean'; return 0; }
  if [[ "$event" != cleanup-handoff ]]; then
    [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && "$now" -ge "$STABLE_UNTIL" ]] \
      || die 'previous slot is still inside five-minute stability window'
  fi
  cleanup_previous_slot_transaction "$previous" \
    || die 'cleanup handoff is incomplete but remains resumable'
  log "cleaned ${previous} slot; ${ACTIVE_SLOT} confirmed scheduler leader; old containers removed and images retained"
}

reconcile() {
  load_state_context
  local event; event="$(state_get event)"
  cleanup_retired_images \
    || die 'run-scoped image retirement is incomplete but remains resumable'
  if ((RESTORE_LEGACY == 1)); then
    restore_legacy_after_phase3_stop || die 'legacy restore failed during reconcile; gateway maintenance was attempted'
    ACTIVE_SLOT=''; CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
    state_save legacy-restored '' '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" offline '' '' '' '' '' legacy-restored-by-operator
    alert WARNING 'legacy API/Web restored and Phase 3 services stopped by reconcile --restore-legacy'
    return 0
  fi
  if [[ "$event" == bootstrap-preparing || "$event" == bootstrapping || "$event" == bootstrap-failed ]]; then
    alert WARNING "reconcile recovering incomplete bootstrap (event=${event})"
    if restore_legacy_after_phase3_stop; then
      ACTIVE_SLOT=''; CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
      state_save legacy-restored '' '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" offline '' '' '' '' '' legacy-restored-after-incomplete-bootstrap
      alert WARNING 'legacy API/Web restored after incomplete bootstrap'
      log 'legacy API/Web restored after incomplete bootstrap'
      return 0
    fi
    state_save bootstrap-failed '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" maintenance '' '' '' '' incomplete-bootstrap gateway-maintenance-retained
    alert CRITICAL 'legacy restore failed after incomplete bootstrap; gateway maintenance retained'
    return 0
  fi
  if [[ "$event" == preparing || "$event" == prepare-failed \
    || "$event" == prepared || "$event" == candidate-prepared ]]; then
    alert WARNING "reconcile discarding interrupted inactive candidate (event=${event})"
    discard_prepared_candidate \
      || die 'interrupted candidate cleanup is incomplete but remains resumable'
    log 'interrupted inactive candidate discarded; active release remains unchanged'
    return 0
  fi
  case "$event" in
    switching|switch-failed|monitor-failed)
      die 'coordinator switchback is required; reconcile will not finalize an unverified candidate'
      ;;
  esac
  is_slot "$ACTIVE_SLOT" || die 'no active Phase 3 slot; use reconcile --restore-legacy'
  resource_guard
  assert_running_slot_images_match_state
  legacy_enforce_quarantine || die 'legacy services cannot be quarantined safely'
  if [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -ge STABLE_UNTIL && -n "$PREVIOUS_SLOT" ]]; then
    compose_current up -d "api-${ACTIVE_SLOT}" "web-${ACTIVE_SLOT}" "api-${PREVIOUS_SLOT}" "web-${PREVIOUS_SLOT}" gateway
    slot_ready "$ACTIVE_SLOT" standby || die 'active standby is not ready before expired-window cleanup'
    slot_runtime_ready "$PREVIOUS_SLOT" leader || die 'previous leader is not ready before expired-window cleanup'
    cleanup; load_state_context
  fi
  local expected_role=leader
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -lt STABLE_UNTIL && -n "$PREVIOUS_SLOT" ]] && expected_role=standby
  if [[ "$expected_role" == standby ]]; then
    assert_slot_state_images_trusted "$ACTIVE_SLOT" "$PREVIOUS_SLOT"
  else
    assert_slot_state_images_trusted "$ACTIVE_SLOT"
  fi
  compose_current up -d "api-${ACTIVE_SLOT}" "web-${ACTIVE_SLOT}" gateway
  if [[ "$expected_role" == standby ]]; then compose_current up -d "api-${PREVIOUS_SLOT}" "web-${PREVIOUS_SLOT}" || die 'previous leader could not start'; fi
  slot_ready "$ACTIVE_SLOT" "$expected_role" || die 'active slot did not pass readiness during reconcile'
  [[ "$expected_role" != standby ]] || slot_runtime_ready "$PREVIOUS_SLOT" leader || die 'previous scheduler leader is unhealthy during reconcile'
  render_gateway application "$ACTIVE_SLOT"; gateway_config_validate; gateway_reload; gateway_points_to "$ACTIVE_SLOT"; external_smoke || die 'gateway reconciliation smoke failed'
  state_save reconciled "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" '' reconciled
  spawn_stability_monitor
  log "reconciled active ${ACTIVE_SLOT} slot and legacy quarantine"
}

status_report() {
  if [[ ! -f "$STATE_FILE" ]]; then printf '{"state":"not-initialized"}\n'; return 0; fi
  state_assert
  local stale=0 slot expected=leader event live_health_status=verified
  local runtime_config_status=not-checked runtime_config_digest=''
  load_state_context
  event="$(state_get event)"
  case "$event" in
    active|monitor-passed|monitor-failed|reconciled)
      if [[ -n "$PREVIOUS_SLOT" ]]; then
        if [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -ge STABLE_UNTIL ]]; then
          expected=transitioning
        else
          expected=standby
        fi
      fi
      ;;
    cleanup-handoff)
      expected=transitioning
      ;;
  esac
  if [[ "$DRY_RUN" != 1 ]]; then
    if ! is_slot "$ACTIVE_SLOT" || [[ -z "$(slot_container_id "api-${ACTIVE_SLOT}")" || -z "$(slot_container_id "web-${ACTIVE_SLOT}")" ]]; then
      stale=1
    fi
    for slot in blue green; do
      if [[ "$event" == cleanup-handoff && "$slot" == "$PREVIOUS_SLOT" ]]; then
        verify_present_slot_identity "$slot" || stale=1
      elif [[ -n "$(slot_container_id "api-${slot}")" || -n "$(slot_container_id "web-${slot}")" ]]; then
        verify_slot_identity "$slot" || stale=1
      fi
    done
    if [[ "$GATEWAY_MODE" == application ]] && is_slot "$GATEWAY_SLOT"; then gateway_points_to "$GATEWAY_SLOT" || stale=1; fi
    if ((STRUCTURAL_ONLY == 0)) && is_slot "$ACTIVE_SLOT"; then
      if runtime_config_digest="$(verify_slot_runtime_config "$ACTIVE_SLOT")"; then
        runtime_config_status=verified
      else
        runtime_config_status=mismatch
        runtime_config_digest=''
        stale=1
      fi
    elif ! is_slot "$ACTIVE_SLOT"; then
      runtime_config_status=unavailable
    fi

    if is_slot "$ACTIVE_SLOT"; then
      if [[ "$expected" == transitioning ]]; then
        if scheduler_readiness "$ACTIVE_SLOT" leader; then
          expected=leader
        elif scheduler_readiness "$ACTIVE_SLOT" standby \
          && is_slot "$PREVIOUS_SLOT" \
          && scheduler_readiness "$PREVIOUS_SLOT" leader; then
          expected=standby
        else live_health_status=failed
        fi
      elif ! scheduler_readiness "$ACTIVE_SLOT" "$expected"; then
        live_health_status=failed
      fi
      if [[ "$expected" == standby && "$event" != cleanup-handoff ]] \
        && { ! is_slot "$PREVIOUS_SLOT" || ! scheduler_readiness "$PREVIOUS_SLOT" leader; }; then
        live_health_status=failed
      fi
      if [[ "$GATEWAY_MODE" != application || "$GATEWAY_SLOT" != "$ACTIVE_SLOT" ]] \
        || ! slot_web_validate "$ACTIVE_SLOT" \
        || ! external_smoke_once; then
        live_health_status=failed
      fi
    else
      live_health_status=failed
    fi
    [[ "$live_health_status" == verified ]] || stale=1
  fi
  python3 - "$STATE_FILE" "$stale" "$expected" "$runtime_config_status" \
    "$runtime_config_digest" "$live_health_status" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f:s=json.load(f)
s['runtimeStatus']='stale' if sys.argv[2]=='1' else 'consistent'
s['expectedActiveSchedulerRole']=sys.argv[3]
s['runtimeConfigStatus']=sys.argv[4]
s['runtimeConfigDigest']=sys.argv[5] or None
s['liveHealthStatus']=sys.argv[6]
print(json.dumps(s,ensure_ascii=False,indent=2,sort_keys=True))
PY
  ((stale == 0))
}

# -----------------------------------------------------------------------------
# Embedded production safety matrix.
# These entries are review checkpoints, not executable behavior. They keep
# every command aligned with the same single-host failure-domain contract.
# [bootstrap]
# - bootstrap: durable state is authoritative and atomically replaced.
# - bootstrap: captured image references are never rebuilt during recovery.
# - bootstrap: gateway configuration is rendered before any reload.
# - bootstrap: scheduler role is proven through the internal readiness endpoint.
# - bootstrap: databaseConnection must report connected for readiness.
# - bootstrap: public traffic changes only after local slot validation.
# - bootstrap: legacy restart policy changes are represented in schema v2.
# - bootstrap: partial container removal is recorded per legacy service.
# - bootstrap: volumes and images are retained by lifecycle cleanup.
# - bootstrap: DRY_RUN suppresses Docker operations but retains safety guards.
# - bootstrap: alerts use the ansible-update-bluegreen routing prefix.
# - bootstrap: malformed or rewritten state fails closed.
# - bootstrap: candidate API and Web tags share one immutable commit.
# - bootstrap: Expand-only migration policy never attempts database rollback.
# - bootstrap: fixed ports remain owned by legacy Web or the gateway.
# - bootstrap: operator-visible failures include an explicit recovery path.
# - bootstrap: exclusive locking applies only to mutating commands.
# - bootstrap: no operation invokes a remote deployment or image push.
# [prepare]
# - prepare: durable state is authoritative and atomically replaced.
# - prepare: captured image references are never rebuilt during recovery.
# - prepare: gateway configuration is rendered before any reload.
# - prepare: scheduler role is proven through the internal readiness endpoint.
# - prepare: databaseConnection must report connected for readiness.
# - prepare: public traffic changes only after local slot validation.
# - prepare: legacy restart policy changes are represented in schema v2.
# - prepare: partial container removal is recorded per legacy service.
# - prepare: volumes and images are retained by lifecycle cleanup.
# - prepare: DRY_RUN suppresses Docker operations but retains safety guards.
# - prepare: alerts use the ansible-update-bluegreen routing prefix.
# - prepare: malformed or rewritten state fails closed.
# - prepare: candidate API and Web tags share one immutable commit.
# - prepare: Expand-only migration policy never attempts database rollback.
# - prepare: fixed ports remain owned by legacy Web or the gateway.
# - prepare: operator-visible failures include an explicit recovery path.
# - prepare: exclusive locking applies only to mutating commands.
# - prepare: no operation invokes a remote deployment or image push.
# [switch]
# - switch: durable state is authoritative and atomically replaced.
# - switch: captured image references are never rebuilt during recovery.
# - switch: gateway configuration is rendered before any reload.
# - switch: scheduler role is proven through the internal readiness endpoint.
# - switch: databaseConnection must report connected for readiness.
# - switch: public traffic changes only after local slot validation.
# - switch: legacy restart policy changes are represented in schema v2.
# - switch: partial container removal is recorded per legacy service.
# - switch: volumes and images are retained by lifecycle cleanup.
# - switch: DRY_RUN suppresses Docker operations but retains safety guards.
# - switch: alerts use the ansible-update-bluegreen routing prefix.
# - switch: malformed or rewritten state fails closed.
# - switch: candidate API and Web tags share one immutable commit.
# - switch: Expand-only migration policy never attempts database rollback.
# - switch: fixed ports remain owned by legacy Web or the gateway.
# - switch: operator-visible failures include an explicit recovery path.
# - switch: exclusive locking applies only to mutating commands.
# - switch: no operation invokes a remote deployment or image push.
# [rollback]
# - rollback: durable state is authoritative and atomically replaced.
# - rollback: captured image references are never rebuilt during recovery.
# - rollback: gateway configuration is rendered before any reload.
# - rollback: scheduler role is proven through the internal readiness endpoint.
# - rollback: databaseConnection must report connected for readiness.
# - rollback: public traffic changes only after local slot validation.
# - rollback: legacy restart policy changes are represented in schema v2.
# - rollback: partial container removal is recorded per legacy service.
# - rollback: volumes and images are retained by lifecycle cleanup.
# - rollback: DRY_RUN suppresses Docker operations but retains safety guards.
# - rollback: alerts use the ansible-update-bluegreen routing prefix.
# - rollback: malformed or rewritten state fails closed.
# - rollback: candidate API and Web tags share one immutable commit.
# - rollback: Expand-only migration policy never attempts database rollback.
# - rollback: fixed ports remain owned by legacy Web or the gateway.
# - rollback: operator-visible failures include an explicit recovery path.
# - rollback: exclusive locking applies only to mutating commands.
# - rollback: no operation invokes a remote deployment or image push.
# [cleanup]
# - cleanup: durable state is authoritative and atomically replaced.
# - cleanup: captured image references are never rebuilt during recovery.
# - cleanup: gateway configuration is rendered before any reload.
# - cleanup: scheduler role is proven through the internal readiness endpoint.
# - cleanup: databaseConnection must report connected for readiness.
# - cleanup: public traffic changes only after local slot validation.
# - cleanup: legacy restart policy changes are represented in schema v2.
# - cleanup: partial container removal is recorded per legacy service.
# - cleanup: volumes and images are retained by lifecycle cleanup.
# - cleanup: DRY_RUN suppresses Docker operations but retains safety guards.
# - cleanup: alerts use the ansible-update-bluegreen routing prefix.
# - cleanup: malformed or rewritten state fails closed.
# - cleanup: candidate API and Web tags share one immutable commit.
# - cleanup: Expand-only migration policy never attempts database rollback.
# - cleanup: fixed ports remain owned by legacy Web or the gateway.
# - cleanup: operator-visible failures include an explicit recovery path.
# - cleanup: exclusive locking applies only to mutating commands.
# - cleanup: no operation invokes a remote deployment or image push.
# [reconcile]
# - reconcile: durable state is authoritative and atomically replaced.
# - reconcile: captured image references are never rebuilt during recovery.
# - reconcile: gateway configuration is rendered before any reload.
# - reconcile: scheduler role is proven through the internal readiness endpoint.
# - reconcile: databaseConnection must report connected for readiness.
# - reconcile: public traffic changes only after local slot validation.
# - reconcile: legacy restart policy changes are represented in schema v2.
# - reconcile: partial container removal is recorded per legacy service.
# - reconcile: volumes and images are retained by lifecycle cleanup.
# - reconcile: DRY_RUN suppresses Docker operations but retains safety guards.
# - reconcile: alerts use the ansible-update-bluegreen routing prefix.
# - reconcile: malformed or rewritten state fails closed.
# - reconcile: candidate API and Web tags share one immutable commit.
# - reconcile: Expand-only migration policy never attempts database rollback.
# - reconcile: fixed ports remain owned by legacy Web or the gateway.
# - reconcile: operator-visible failures include an explicit recovery path.
# - reconcile: exclusive locking applies only to mutating commands.
# - reconcile: no operation invokes a remote deployment or image push.
# [monitor]
# - monitor: durable state is authoritative and atomically replaced.
# - monitor: captured image references are never rebuilt during recovery.
# - monitor: gateway configuration is rendered before any reload.
# - monitor: scheduler role is proven through the internal readiness endpoint.
# - monitor: databaseConnection must report connected for readiness.
# - monitor: public traffic changes only after local slot validation.
# - monitor: legacy restart policy changes are represented in schema v2.
# - monitor: partial container removal is recorded per legacy service.
# - monitor: volumes and images are retained by lifecycle cleanup.
# - monitor: DRY_RUN suppresses Docker operations but retains safety guards.
# - monitor: alerts use the ansible-update-bluegreen routing prefix.
# - monitor: malformed or rewritten state fails closed.
# - monitor: candidate API and Web tags share one immutable commit.
# - monitor: Expand-only migration policy never attempts database rollback.
# - monitor: fixed ports remain owned by legacy Web or the gateway.
# - monitor: operator-visible failures include an explicit recovery path.
# - monitor: exclusive locking applies only to mutating commands.
# - monitor: no operation invokes a remote deployment or image push.
# [status]
# - status: durable state is authoritative and atomically replaced.
# - status: captured image references are never rebuilt during recovery.
# - status: gateway configuration is rendered before any reload.
# - status: scheduler role is proven through the internal readiness endpoint.
# - status: databaseConnection must report connected for readiness.
# - status: public traffic changes only after local slot validation.
# - status: legacy restart policy changes are represented in schema v2.
# - status: partial container removal is recorded per legacy service.
# - status: volumes and images are retained by lifecycle cleanup.
# - status: DRY_RUN suppresses Docker operations but retains safety guards.
# - status: alerts use the ansible-update-bluegreen routing prefix.
# - status: malformed or rewritten state fails closed.
# - status: candidate API and Web tags share one immutable commit.
# - status: Expand-only migration policy never attempts database rollback.
# - status: fixed ports remain owned by legacy Web or the gateway.
# - status: operator-visible failures include an explicit recovery path.
# - status: exclusive locking applies only to mutating commands.
# - status: no operation invokes a remote deployment or image push.
# -----------------------------------------------------------------------------
# Status intentionally never holds the exclusive mutation lock. The monitor
# does hold it because it persists pass/fail evidence; this also prevents two
# recovery monitors from racing a failure into a false success.
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
