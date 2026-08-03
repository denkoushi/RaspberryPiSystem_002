# shellcheck shell=bash
# Source-only safety policy, coordinator authority, alerts, and lock helpers.

validate_fixed_safety_policy() {
  local production=0 name value control_name
  [[ "$DRY_RUN" == 1 && "${ROLLING_RELEASE_PROTOCOL:-}" != 2 ]] || production=1
  if ((production == 1)); then
    [[ "$STABLE_SECONDS" == 300 ]] || die 'production Blue/Green stability hold is fixed at 300 seconds'
    [[ "$MONITOR_INTERVAL" == 2 ]] || die 'production Blue/Green monitor interval is fixed at 2 seconds'
    [[ "$MONITOR_STRUCTURAL_SAMPLE_INTERVAL" == 15 ]] \
      || die 'production Blue/Green structural monitor interval is fixed at 15 samples'
    if [[ "${ROLLING_RELEASE_PROTOCOL:-}" == 2 ]]; then
      [[ "$MAX_ERROR_RATE" == 0.05 ]] || die 'rolling-release maximum error rate is fixed at 0.05'
      [[ "$MIN_ERROR_SAMPLES" == 20 ]] || die 'rolling-release minimum error samples are fixed at 20'
      [[ "$MIN_MEMORY_MB" == 1536 ]] || die 'rolling-release Blue/Green memory threshold is fixed at 1536MB'
      [[ "$MIN_DISK_GB" == 10 ]] || die 'rolling-release Blue/Green disk threshold is fixed at 10GB'
      [[ -z "$MAX_LOAD_AVG" ]] || die 'rolling-release Blue/Green load threshold is derived from online CPUs'
      [[ "$EVIDENCE_MIN_MEMORY_MB" == 768 ]] || die 'rolling-release evidence memory threshold is fixed at 768MB'
      [[ "$EVIDENCE_MIN_DISK_GB" == 10 ]] || die 'rolling-release evidence disk threshold is fixed at 10GB'
      [[ -z "$EVIDENCE_MAX_LOAD_AVG" ]] || die 'rolling-release evidence load threshold is derived from online CPUs'
      [[ "$READINESS_RETRIES" == 45 && "$READINESS_INTERVAL" == 2 ]] \
        || die 'rolling-release slot readiness timing is fixed at 45 attempts / 2 seconds'
      [[ "$GATEWAY_READY_RETRIES" == 60 && "$GATEWAY_READY_INTERVAL" == 1 ]] \
        || die 'rolling-release gateway readiness timing is fixed at 60 attempts / 1 second'
      for control_name in DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_DEFAULT_PLATFORM \
        BUILDKIT_HOST BUILDX_CONFIG COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES \
        COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR; do
        [[ -z "${!control_name:-}" ]] \
          || die "Docker/Compose control environment is forbidden under rolling-release: ${control_name}"
      done
    fi
    if [[ "$COMMAND" != status ]]; then
      for name in \
        PI5_BLUE_GREEN_TEST_MEMORY_MB \
        PI5_BLUE_GREEN_TEST_DISK_GB \
        PI5_BLUE_GREEN_TEST_LOAD_AVG \
        PI5_BLUE_GREEN_TEST_ALLOW_MISSING_RELEASE_EVIDENCE \
        PI5_BLUE_GREEN_SKIP_RESOURCE_GUARD; do
        value="${!name:-}"
        [[ -z "$value" ]] || die "test-only environment is forbidden in production: ${name}"
      done
    fi
  else
    [[ "$STABLE_SECONDS" =~ ^[0-9]+$ ]] || die 'test stability hold must be a non-negative integer'
    [[ "$MONITOR_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'test monitor interval is invalid'
    [[ "$MONITOR_STRUCTURAL_SAMPLE_INTERVAL" =~ ^[1-9][0-9]*$ ]] \
      || die 'test structural monitor interval is invalid'
  fi
  python3 - "$MAX_ERROR_RATE" <<'PY' || die 'maximum error rate must be finite and between 0 and 1'
import math, sys
try: value=float(sys.argv[1])
except ValueError: raise SystemExit(1)
raise SystemExit(0 if math.isfinite(value) and 0 <= value <= 1 else 1)
PY
  [[ "$MIN_ERROR_SAMPLES" =~ ^[1-9][0-9]*$ ]] || die 'minimum error sample count must be a positive integer'
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

enable_prior_handoff_recovery_mode() {
  local run_id="${PI5_PRIOR_HANDOFF_RECOVERY_RUN_ID:-}"
  [[ -n "$run_id" ]] || return 0
  [[ "$COMMAND" == status || "$COMMAND" == cleanup || "$COMMAND" == seal-image-ids \
    || "$COMMAND" == rollback || "$COMMAND" == monitor || "$COMMAND" == restart-monitor ]] \
    || die 'prior-handoff recovery mode is invalid for this command'
  [[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] || die 'prior-handoff recovery run ID is malformed'
  [[ "${ROLLING_RELEASE_PROTOCOL:-}" == 2 ]] || die 'prior-handoff recovery requires the rolling-release protocol'
  [[ "${ROLLING_RELEASE_UNIT:-}" == "raspi-release-${run_id}.service" ]] || die 'prior-handoff recovery unit identity does not match'
  [[ "${INVOCATION_ID:-}" =~ ^[0-9a-fA-F]{32}$ ]] || die 'prior-handoff recovery invocation identity is missing'
  python3 - "$FLEET_STATE_FILE" "$run_id" <<'PY' || die 'prior-handoff recovery is not owned by the active fleet run'
import json, sys
path, run_id = sys.argv[1:]
try:
    with open(path, encoding='utf-8') as stream:
        state = json.load(stream)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)
active = state.get('activeRun') if isinstance(state, dict) else None
if not isinstance(active, dict):
    raise SystemExit(1)
if active.get('runId') != run_id or active.get('status') != 'running':
    raise SystemExit(1)
PY
  STRUCTURAL_ONLY=1
}

lock_cleanup() {
  if ((LOCK_FALLBACK == 1)) && [[ -n "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

alert() {
  local severity="$1" message="$2" stamp destination
  stamp="$(date -u +'%Y%m%dT%H%M%S')-$$-${RANDOM}"
  destination="${ALERT_DIR}/ansible-update-bluegreen-${stamp}.json"
  log "ALERT ${severity}: ${message}" >&2
  [[ "$DRY_RUN" == 1 && "${PI5_BLUE_GREEN_DRY_RUN_ALERTS:-0}" != 1 ]] && return 0
  mkdir -p "$ALERT_DIR"
  python3 - "$destination" "$severity" "$message" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, severity, message = sys.argv[1:]
payload = {
    'source': 'ansible-update-bluegreen-' + os.path.basename(path),
    'severity': severity,
    'message': message,
    'acknowledged': False,
    'createdAt': datetime.now(timezone.utc).isoformat(),
}
fd, tmp = tempfile.mkstemp(prefix='.bluegreen-alert-', dir=os.path.dirname(path))
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(payload, f, separators=(',', ':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
os.replace(tmp, path)
PY
}
