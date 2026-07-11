#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
PHASE3_COMPOSE="${PI5_PHASE3_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.yml}"
ENV_FILE="${PI5_ENV_FILE:-${PROJECT_DIR}/infrastructure/docker/.env}"
PHASE2_STATE_FILE="${PI5_PHASE2_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-image-deploy-state.json}"
STATE_FILE="${PI5_BLUE_GREEN_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json}"
LOCK_FILE="${PI5_BLUE_GREEN_LOCK_FILE:-${PROJECT_DIR}/logs/.pi5-blue-green.lock}"
CONFIG_DIR="${PI5_BLUE_GREEN_CONFIG_DIR:-${PROJECT_DIR}/logs/deploy/bluegreen}"
COMPOSE_PROJECT="${PI5_BLUE_GREEN_COMPOSE_PROJECT:-bluegreen}"
GATEWAY_TEMPLATE="${PI5_GATEWAY_TEMPLATE:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.gateway.template}"
GATEWAY_HTTP_TEMPLATE="${PI5_GATEWAY_HTTP_TEMPLATE:-${PROJECT_DIR}/infrastructure/docker/Caddyfile.gateway.http.template}"
API_HEALTH_URL="${PI5_BLUE_GREEN_HEALTH_URL:-https://127.0.0.1/api/system/health}"
WEB_URL="${PI5_BLUE_GREEN_WEB_URL:-https://127.0.0.1/}"
KIOSK_HEALTH_URL="${PI5_BLUE_GREEN_KIOSK_HEALTH_URL:-}"
ERROR_RATE_URL="${PI5_BLUE_GREEN_ERROR_RATE_URL:-}"
MAX_ERROR_RATE="${PI5_BLUE_GREEN_MAX_ERROR_RATE:-0.05}"
MIN_MEMORY_MB="${PI5_BLUE_GREEN_MIN_MEMORY_MB:-1536}"
MIN_DISK_GB="${PI5_BLUE_GREEN_MIN_DISK_GB:-10}"
MAX_LOAD_AVG="${PI5_BLUE_GREEN_MAX_LOAD_AVG:-4.0}"
STABLE_SECONDS="${PI5_BLUE_GREEN_STABLE_SECONDS:-300}"
MONITOR_INTERVAL="${PI5_BLUE_GREEN_MONITOR_INTERVAL:-2}"
DRY_RUN="${PI5_BLUE_GREEN_DRY_RUN:-0}"
HTTP_ONLY="${PI5_BLUE_GREEN_HTTP_ONLY:-0}"
CONFIRM_BOOTSTRAP=0
API_IMAGE=""
WEB_IMAGE=""
ROLLBACK_REASON=""

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: pi5-blue-green.sh <status|bootstrap|prepare|switch|rollback|cleanup> [options]
  --api-image IMAGE --web-image IMAGE  candidate images (or Phase 2 candidate state)
  --confirm-bootstrap                  required for the first gateway cutover
  --dry-run                            validate state/config without running Docker
  --reason TEXT                        rollback reason
EOF
}

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || { usage; exit 2; }
shift || true
while (($#)); do
  case "$1" in
    --api-image) API_IMAGE="${2:-}"; shift 2 ;;
    --web-image) WEB_IMAGE="${2:-}"; shift 2 ;;
    --confirm-bootstrap) CONFIRM_BOOTSTRAP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --reason) ROLLBACK_REASON="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

state_value() {
  local path="$1" key="$2"
  [[ -f "$path" ]] || return 0
  python3 - "$path" "$key" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f: value=json.load(f)
for part in sys.argv[2].split('.'):
    value = value.get(part) if isinstance(value, dict) else None
if value is not None: print(value)
PY
}

state_write() {
  local event="$1" active="$2" candidate="$3" previous="$4" active_api="$5" active_web="$6" candidate_api="$7" candidate_web="$8" previous_api="$9" previous_web="${10}" switched="${11}" stable="${12}" reason="${13}" result="${14}"
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$event" "$active" "$candidate" "$previous" "$active_api" "$active_web" "$candidate_api" "$candidate_web" "$previous_api" "$previous_web" "$switched" "$stable" "$reason" "$result" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, event, active, candidate, previous, active_api, active_web, candidate_api, candidate_web, previous_api, previous_web, switched, stable, reason, result = sys.argv[1:]
try:
    with open(path, encoding='utf-8') as f: state=json.load(f)
except (FileNotFoundError, json.JSONDecodeError): state={'version': 1}
def maybe(v): return v or None
state.update({'version': 1, 'event': event, 'updatedAt': datetime.now(timezone.utc).isoformat(),
              'activeSlot': maybe(active), 'candidateSlot': maybe(candidate), 'previousSlot': maybe(previous),
              'activeImages': {'api': active_api, 'web': active_web} if active_api or active_web else None,
              'candidateImages': {'api': candidate_api, 'web': candidate_web} if candidate_api or candidate_web else None,
              'previousImages': {'api': previous_api, 'web': previous_web} if previous_api or previous_web else None,
              'switchedAt': maybe(switched), 'stableUntil': int(stable) if stable.isdigit() else maybe(stable),
              'rollbackReason': maybe(reason), 'result': maybe(result)})
fd, tmp=tempfile.mkstemp(prefix='.pi5-blue-green-', dir=os.path.dirname(path))
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(state, f, ensure_ascii=False, separators=(',', ':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
os.replace(tmp, path)
PY
}

state_event() {
  local event="$1" result="$2"
  python3 - "$STATE_FILE" "$event" "$result" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, event, result=sys.argv[1:]
with open(path, encoding='utf-8') as f: state=json.load(f)
state.update({'event': event, 'updatedAt': datetime.now(timezone.utc).isoformat(), 'result': result})
fd, tmp=tempfile.mkstemp(prefix='.pi5-blue-green-', dir=os.path.dirname(path))
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(state, f, ensure_ascii=False, separators=(',', ':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
os.replace(tmp, path)
PY
}

resource_value() {
  case "$1" in
    memory) [[ -n "${PI5_BLUE_GREEN_TEST_MEMORY_MB:-}" ]] && echo "$PI5_BLUE_GREEN_TEST_MEMORY_MB" || awk '/MemAvailable:/ {print int($2/1024); exit}' /proc/meminfo ;;
    disk) [[ -n "${PI5_BLUE_GREEN_TEST_DISK_GB:-}" ]] && echo "$PI5_BLUE_GREEN_TEST_DISK_GB" || df -Pk "$PROJECT_DIR" | awk 'NR==2 {print int($4/1024/1024); exit}' ;;
    load) [[ -n "${PI5_BLUE_GREEN_TEST_LOAD_AVG:-}" ]] && echo "$PI5_BLUE_GREEN_TEST_LOAD_AVG" || awk '{print $1; exit}' /proc/loadavg ;;
  esac
}
resource_guard() {
  [[ "${PI5_BLUE_GREEN_SKIP_RESOURCE_GUARD:-0}" == 1 ]] && return 0
  local memory disk load
  memory="$(resource_value memory)"; disk="$(resource_value disk)"; load="$(resource_value load)"
  [[ "$memory" =~ ^[0-9]+$ ]] || die "available memory could not be read"
  [[ "$disk" =~ ^[0-9]+$ ]] || die "free disk could not be read"
  awk "BEGIN {exit !($load < $MAX_LOAD_AVG)}" || die "load average ${load} is not below ${MAX_LOAD_AVG}"
  ((memory >= MIN_MEMORY_MB)) || die "available memory ${memory}MB is below ${MIN_MEMORY_MB}MB; fallback to scripts/deploy/pi5-image-deploy.sh"
  ((disk >= MIN_DISK_GB)) || die "free disk ${disk}GB is below ${MIN_DISK_GB}GB; fallback to scripts/deploy/pi5-image-deploy.sh"
  log "resource gate passed: memory=${memory}MB disk=${disk}GB load=${load}"
}

compose() {
  local ba="$1" ga="$2" bw="$3" gw="$4" gateway="$5"; shift 5
  if [[ "$DRY_RUN" == 1 ]]; then
    printf 'DRY-RUN: docker compose -p %q -f %q' "$COMPOSE_PROJECT" "$PHASE3_COMPOSE"; printf ' %q' "$@"; printf '\n'; return 0
  fi
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  PI5_PROJECT_DIR="$PROJECT_DIR" PI5_ENV_FILE="$ENV_FILE" PI5_BLUE_GREEN_CONFIG_DIR="$CONFIG_DIR" \
    PI5_BLUE_API_IMAGE="$ba" PI5_GREEN_API_IMAGE="$ga" PI5_BLUE_WEB_IMAGE="$bw" PI5_GREEN_WEB_IMAGE="$gw" PI5_GATEWAY_IMAGE="$gateway" \
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$PHASE3_COMPOSE" "$@"
}

resolve_images() {
  [[ -n "$API_IMAGE" ]] || API_IMAGE="$(state_value "$PHASE2_STATE_FILE" candidate.api)"
  [[ -n "$WEB_IMAGE" ]] || WEB_IMAGE="$(state_value "$PHASE2_STATE_FILE" candidate.web)"
  [[ -n "$API_IMAGE" && -n "$WEB_IMAGE" ]] || die "candidate images are missing; pass --api-image and --web-image"
  [[ "$DRY_RUN" == 1 ]] || docker image inspect "$API_IMAGE" "$WEB_IMAGE" >/dev/null || die "candidate image is missing"
}
other_slot() { [[ "$1" == blue ]] && echo green || echo blue; }
active_api() { state_value "$STATE_FILE" activeImages.api; }
active_web() { state_value "$STATE_FILE" activeImages.web; }
candidate_api() { state_value "$STATE_FILE" candidateImages.api; }
candidate_web() { state_value "$STATE_FILE" candidateImages.web; }

render_gateway() {
  local slot="$1" template="$GATEWAY_TEMPLATE"
  [[ "$HTTP_ONLY" == 1 ]] && template="$GATEWAY_HTTP_TEMPLATE"
  [[ -f "$template" ]] || die "gateway template is missing: $template"
  mkdir -p "$CONFIG_DIR"
  python3 - "$template" "$CONFIG_DIR/Caddyfile" "api-${slot}:8080" "web-${slot}:80" <<'PY'
import os, sys, tempfile
template, destination, api, web=sys.argv[1:]
with open(template, encoding='utf-8') as f: content=f.read()
content=content.replace('__BLUE_GREEN_API_UPSTREAM__', api).replace('__BLUE_GREEN_WEB_UPSTREAM__', web)
fd, tmp=tempfile.mkstemp(prefix='.Caddyfile-', dir=os.path.dirname(destination), text=True)
with os.fdopen(fd, 'w', encoding='utf-8') as f: f.write(content); f.flush(); os.fsync(f.fileno())
os.replace(tmp, destination)
PY
  log "gateway config rendered for ${slot}"
}
gateway_reload() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local ba="$(active_api)" ga="$(candidate_api)" bw="$(active_web)" gw="$(candidate_web)"
  [[ -n "$ba" ]] || ba="$API_IMAGE"; [[ -n "$ga" ]] || ga="$API_IMAGE"
  [[ -n "$bw" ]] || bw="$WEB_IMAGE"; [[ -n "$gw" ]] || gw="$WEB_IMAGE"
  compose "$ba" "$ga" "$bw" "$gw" "$bw" exec -T gateway caddy reload --config /srv/bluegreen/Caddyfile
}

slot_health() {
  local slot="$1" cid ba="$(active_api)" ga="$(candidate_api)" bw="$(active_web)" gw="$(candidate_web)"
  [[ -n "$ba" ]] || ba="$API_IMAGE"; [[ -n "$ga" ]] || ga="$API_IMAGE"
  [[ -n "$bw" ]] || bw="$WEB_IMAGE"; [[ -n "$gw" ]] || gw="$WEB_IMAGE"
  [[ "$DRY_RUN" == 1 ]] && return 0
  for _ in $(seq 1 45); do
    cid="$(compose "$ba" "$ga" "$bw" "$gw" "$bw" ps -q "api-${slot}" 2>/dev/null || true)"
    if [[ -n "$cid" ]] && docker exec "$cid" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then return 0; fi
    sleep 2
  done
  return 1
}
slot_web_validate() {
  local slot="$1" cid ba="$(active_api)" ga="$(candidate_api)" bw="$(active_web)" gw="$(candidate_web)"
  [[ -n "$ba" ]] || ba="$API_IMAGE"; [[ -n "$ga" ]] || ga="$API_IMAGE"
  [[ -n "$bw" ]] || bw="$WEB_IMAGE"; [[ -n "$gw" ]] || gw="$WEB_IMAGE"
  [[ "$DRY_RUN" == 1 ]] && return 0
  cid="$(compose "$ba" "$ga" "$bw" "$gw" "$bw" ps -q "web-${slot}" 2>/dev/null || true)"
  [[ -n "$cid" ]] && docker exec "$cid" caddy validate --config /srv/Caddyfile.slot >/dev/null
}
external_smoke() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  curl -kfsS --max-time 5 "$API_HEALTH_URL" >/dev/null || return 1
  curl -kfsS --max-time 5 "$WEB_URL" >/dev/null || return 1
  [[ -z "$KIOSK_HEALTH_URL" ]] || curl -kfsS --max-time 5 "$KIOSK_HEALTH_URL" >/dev/null
  if [[ -n "$ERROR_RATE_URL" ]]; then
    local error_rate
    error_rate="$(curl -kfsS --max-time 5 "$ERROR_RATE_URL" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(float(d.get("errorRate", d.get("error_rate", 1))))')" || return 1
    awk "BEGIN {exit !($error_rate <= $MAX_ERROR_RATE)}" || return 1
  fi
}

slot_up() {
  local slot="$1" ba="$2" ga="$3" bw="$4" gw="$5" gateway="$6"
  compose "$ba" "$ga" "$bw" "$gw" "$gateway" up -d "api-${slot}" "web-${slot}"
  slot_health "$slot" || die "API health failed for ${slot} slot"
  slot_web_validate "$slot" || die "Caddy validation failed for ${slot} Web slot"
}

bootstrap() {
  ((CONFIRM_BOOTSTRAP == 1)) || die "first bootstrap requires --confirm-bootstrap"
  [[ ! -f "$STATE_FILE" ]] || die "Blue/Green state already exists"
  resolve_images; resource_guard; render_gateway blue
  slot_up blue "$API_IMAGE" "" "$WEB_IMAGE" "" "$WEB_IMAGE"
  compose "$API_IMAGE" "" "$WEB_IMAGE" "" "$WEB_IMAGE" up -d gateway
  gateway_reload
  external_smoke || die "gateway bootstrap smoke failed; existing Web service was not stopped automatically"
  state_write active blue "" "" "$API_IMAGE" "$WEB_IMAGE" "" "" "" "" "" "" "" success
  log "Blue/Green bootstrap completed; blue is active"
}

prepare() {
  local active candidate ba ga bw gw
  [[ -f "$STATE_FILE" ]] || die "Blue/Green is not bootstrapped; run bootstrap first"
  active="$(state_value "$STATE_FILE" activeSlot)"; [[ "$active" == blue || "$active" == green ]] || die "active slot is missing"
  candidate="$(other_slot "$active")"; resolve_images; resource_guard
  ba="$(active_api)"; bw="$(active_web)"; ga="$API_IMAGE"; gw="$WEB_IMAGE"
  [[ "$active" == green ]] && { ba="$API_IMAGE"; ga="$(active_api)"; bw="$WEB_IMAGE"; gw="$(active_web)"; }
  slot_up "$candidate" "$ba" "$ga" "$bw" "$gw" "$WEB_IMAGE"
  state_write prepared "$active" "$candidate" "$active" "$(active_api)" "$(active_web)" "$API_IMAGE" "$WEB_IMAGE" "$(active_api)" "$(active_web)" "" "" "" success
  log "candidate prepared in ${candidate} slot"
}

rollback_internal() {
  local target="$1" failed="$2" reason="$3" target_api target_web
  target_api="$(state_value "$STATE_FILE" previousImages.api)"; target_web="$(state_value "$STATE_FILE" previousImages.web)"
  [[ -n "$target_api" ]] || target_api="$(active_api)"; [[ -n "$target_web" ]] || target_web="$(active_web)"
  render_gateway "$target" || true; gateway_reload || true
  if external_smoke; then
    state_write rolled-back "$target" "$failed" "$failed" "$target_api" "$target_web" "$(candidate_api)" "$(candidate_web)" "$target_api" "$target_web" "" "" "$reason" rollback-success
    log "rollback completed: ${reason}"; return 0
  fi
  state_event rollback-failed "$reason"; return 1
}

switch_candidate() {
  local active candidate started now stable
  active="$(state_value "$STATE_FILE" activeSlot)"; candidate="$(state_value "$STATE_FILE" candidateSlot)"
  [[ "$active" == blue || "$active" == green ]] || die "active slot is missing"
  [[ "$candidate" == blue || "$candidate" == green ]] || die "candidate slot is missing; run prepare"
  [[ "$active" != "$candidate" ]] || die "candidate is already active"
  slot_health "$candidate" || die "candidate API is not healthy"; slot_web_validate "$candidate" || die "candidate Web is not valid"
  started="$(date +%s)"
  state_write switching "$active" "$candidate" "$active" "$(active_api)" "$(active_web)" "$(candidate_api)" "$(candidate_web)" "$(active_api)" "$(active_web)" "" "" "" switching
  if ! render_gateway "$candidate" || ! gateway_reload || ! external_smoke; then
    rollback_internal "$active" "$candidate" "gateway or external smoke failed" || true
    die "switch failed; previous slot remains the recovery target"
  fi
  now="$(date +%s)"; stable=$((now + STABLE_SECONDS))
  state_write active "$candidate" "$active" "$active" "$(candidate_api)" "$(candidate_web)" "$(candidate_api)" "$(candidate_web)" "$(active_api)" "$(active_web)" "$now" "$stable" "" "success:$((now-started))s"
  log "switch completed; ${candidate} is active and ${active} is retained until ${stable}"
  [[ "$DRY_RUN" == 1 ]] || nohup sh -c "sleep 1; exec '$SCRIPT_PATH' monitor" >>"${STATE_FILE}.monitor.log" 2>&1 &
}

rollback() {
  local active previous
  active="$(state_value "$STATE_FILE" activeSlot)"; previous="$(state_value "$STATE_FILE" previousSlot)"
  [[ "$active" == blue || "$active" == green ]] || die "active slot is missing"
  [[ "$previous" == blue || "$previous" == green ]] || die "no previous slot is recorded"
  rollback_internal "$previous" "$active" "${ROLLBACK_REASON:-manual rollback}" || die "manual rollback failed"
}
monitor() {
  local deadline
  while [[ -f "$STATE_FILE" ]]; do
    [[ "$(state_value "$STATE_FILE" event)" == active ]] || return 0
    deadline="$(state_value "$STATE_FILE" stableUntil)"; [[ "$deadline" =~ ^[0-9]+$ ]] || return 0
    (( $(date +%s) < deadline )) || return 0
    if ! external_smoke; then rollback_internal "$(state_value "$STATE_FILE" previousSlot)" "$(state_value "$STATE_FILE" activeSlot)" "automatic monitor threshold failure" || true; return 1; fi
    sleep "$MONITOR_INTERVAL"
  done
}
cleanup() {
  local active previous deadline
  active="$(state_value "$STATE_FILE" activeSlot)"; previous="$(state_value "$STATE_FILE" previousSlot)"; deadline="$(state_value "$STATE_FILE" stableUntil)"
  [[ "$active" == blue || "$active" == green ]] || die "active slot is missing"
  [[ "$previous" == blue || "$previous" == green ]] || { log "no previous slot to clean"; return 0; }
  [[ "$deadline" =~ ^[0-9]+$ && $(date +%s) -ge "$deadline" ]] || die "previous slot is still inside the five-minute stability window"
  compose "$(active_api)" "$(candidate_api)" "$(active_web)" "$(candidate_web)" "$(active_web)" stop "api-${previous}" "web-${previous}"
  state_event cleaned "previous slot stopped after stability window"; log "cleaned ${previous} slot; images retained"
}

mkdir -p "$(dirname "$LOCK_FILE")"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"; flock -n 9 || die "another Pi5 Blue/Green operation is running"
else
  LOCK_DIR="${LOCK_FILE}.d"; mkdir "$LOCK_DIR" 2>/dev/null || die "another Pi5 Blue/Green operation is running"; trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi
case "$COMMAND" in
  status) [[ -f "$STATE_FILE" ]] && python3 -m json.tool "$STATE_FILE" || echo '{"state":"not-initialized"}' ;;
  bootstrap) bootstrap ;;
  prepare) prepare ;;
  switch) switch_candidate ;;
  rollback) rollback ;;
  cleanup) cleanup ;;
  monitor) monitor ;;
  *) usage; exit 2 ;;
esac
