#!/usr/bin/env bash
# Pi5 Phase 3 single-host Blue/Green deployment controller.
# Safety model: fixed gateway, immutable slot images, PostgreSQL scheduler lock,
# durable schema-v2 state, captured-image legacy recovery, and fail-closed guards.
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
BASE_COMPOSE="${PI5_BASE_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
PHASE3_COMPOSE="${PI5_PHASE3_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.yml}"
ENV_FILE="${PI5_ENV_FILE:-${PROJECT_DIR}/infrastructure/docker/.env}"
PHASE2_STATE_FILE="${PI5_PHASE2_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-image-deploy-state.json}"
STATE_FILE="${PI5_BLUE_GREEN_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json}"
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
STABLE_SECONDS="${PI5_BLUE_GREEN_STABLE_SECONDS:-300}"
MONITOR_INTERVAL="${PI5_BLUE_GREEN_MONITOR_INTERVAL:-2}"
READINESS_RETRIES="${PI5_BLUE_GREEN_READINESS_RETRIES:-45}"
READINESS_INTERVAL="${PI5_BLUE_GREEN_READINESS_INTERVAL:-2}"
# Pi5's Docker port handoff from legacy Web to the fixed gateway can take
# longer than the Caddy process itself. Keep maintenance mode and wait up to a
# minute before treating the host listener as failed.
GATEWAY_READY_RETRIES="${PI5_BLUE_GREEN_GATEWAY_READY_RETRIES:-60}"
GATEWAY_READY_INTERVAL="${PI5_BLUE_GREEN_GATEWAY_READY_INTERVAL:-1}"
DRY_RUN="${PI5_BLUE_GREEN_DRY_RUN:-${DRY_RUN:-0}}"
HTTP_ONLY="${PI5_BLUE_GREEN_HTTP_ONLY:-0}"
MIGRATION_BASE_REF="${PI5_BLUE_GREEN_MIGRATION_BASE_REF:-}"

COMMAND="${1:-}"
CONFIRM_BOOTSTRAP=0
ALLOW_LEGACY_HANDOFF=0
RESTORE_LEGACY=0
API_IMAGE=""
WEB_IMAGE=""
ROLLBACK_REASON=""
LOCK_DIR=""
LOCK_FALLBACK=0
BOOTSTRAP_RECOVERY_ARMED=0

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
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$COMMAND" in
  status|bootstrap|prepare|switch|rollback|cleanup|reconcile|monitor) ;;
  *) usage; exit 2 ;;
esac
((RESTORE_LEGACY == 0)) || [[ "$COMMAND" == reconcile ]] || die '--restore-legacy is valid only with reconcile'
[[ "$GATEWAY_READY_RETRIES" =~ ^[1-9][0-9]*$ ]] || die 'gateway readiness retries must be a positive integer'
[[ "$GATEWAY_READY_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'gateway readiness interval must be a non-negative number'

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

state_get() {
  local key="$1"
  [[ -f "$STATE_FILE" ]] || return 0
  python3 - "$STATE_FILE" "$key" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    value = json.load(f)
for part in sys.argv[2].split('.'):
    value = value.get(part) if isinstance(value, dict) else None
if value is True: print('1')
elif value is False: print('0')
elif value is not None: print(value)
PY
}

state_assert() {
  [[ -f "$STATE_FILE" ]] || die "Blue/Green state is absent: $STATE_FILE"
  python3 - "$STATE_FILE" <<'PY' || exit $?
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding='utf-8') as f: s = json.load(f)
except Exception as exc:
    raise SystemExit(f'malformed Blue/Green state: {exc}')
if s.get('version') != 2:
    raise SystemExit('Blue/Green state schema must be version 2')
slots = s.get('slots')
if not isinstance(slots, dict) or not all(x in slots for x in ('blue','green')):
    raise SystemExit('Blue/Green state has no fixed slots map')
for name in ('blue','green'):
    images = slots[name].get('images') if isinstance(slots[name], dict) else None
    if not isinstance(images, dict) or not all(x in images for x in ('api','web')):
        raise SystemExit(f'Blue/Green state has malformed {name} images')
for key in ('legacy','monitor','migration','gateway'):
    if not isinstance(s.get(key), dict):
        raise SystemExit(f'Blue/Green state has malformed {key} metadata')
legacy_path = s['legacy'].get('caddyConfigPath')
if legacy_path not in (None, '/srv/Caddyfile', '/srv/Caddyfile.local', '/srv/Caddyfile.production'):
    raise SystemExit('Blue/Green state has an unsafe legacy Caddyfile path')
for key in ('activeSlot','candidateSlot','previousSlot'):
    if s.get(key) not in (None,'blue','green'):
        raise SystemExit(f'Blue/Green state has invalid {key}')
mon=s['monitor']
if mon.get('activeSlot') not in (None,'blue','green') or mon.get('rollbackSlot') not in (None,'blue','green'):
    raise SystemExit('Blue/Green state has invalid monitor slots')

def require_images(slot, purpose):
    images = slots[slot]['images']
    api, web = images.get('api'), images.get('web')
    if not isinstance(api, str) or not api.strip() or not isinstance(web, str) or not web.strip():
        raise SystemExit(f'Blue/Green state has incomplete {purpose} image pair for {slot}')

for key in ('activeSlot', 'candidateSlot', 'previousSlot'):
    slot = s.get(key)
    if slot is not None:
        require_images(slot, key)
for key in ('activeSlot', 'rollbackSlot'):
    slot = mon.get(key)
    if slot is not None:
        require_images(slot, f'monitor.{key}')
gateway = s['gateway']
if gateway.get('mode') == 'application':
    slot = gateway.get('slot')
    if slot not in ('blue', 'green'):
        raise SystemExit('Blue/Green application gateway has invalid slot')
    require_images(slot, 'gateway')
PY
}

state_save() {
  local event="$1" active="$2" candidate="$3" previous="$4"
  local blue_api="$5" blue_web="$6" green_api="$7" green_web="$8"
  local gateway_mode="$9" gateway_slot="${10}" stable="${11}"
  local monitor_active="${12}" monitor_rollback="${13}" reason="${14}" result="${15}"
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$event" "$active" "$candidate" "$previous" \
    "$blue_api" "$blue_web" "$green_api" "$green_web" "$gateway_mode" "$gateway_slot" \
    "$stable" "$monitor_active" "$monitor_rollback" "$reason" "$result" \
    "$LEGACY_API_ID" "$LEGACY_WEB_ID" "$LEGACY_API_IMAGE" "$LEGACY_WEB_IMAGE" \
    "$LEGACY_API_RESTART" "$LEGACY_WEB_RESTART" "$LEGACY_API_WAS_RUNNING" "$LEGACY_WEB_WAS_RUNNING" \
    "$LEGACY_API_QUARANTINED" "$LEGACY_WEB_QUARANTINED" "$LEGACY_API_REMOVED" "$LEGACY_WEB_REMOVED" \
    "$LEGACY_WEB_MAINTENANCE" "$LEGACY_NORMAL_CONFIG_B64" "$LEGACY_CADDY_CONFIG_PATH" "$MIGRATION_BASE_COMMIT" \
    "$MIGRATION_CANDIDATE_COMMIT" "$MIGRATION_STATUS" "$MIGRATION_CHECKED_AT" "$MIGRATION_APPLIED_AT" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
(path,event,active,candidate,previous,blue_api,blue_web,green_api,green_web,
 gateway_mode,gateway_slot,stable,monitor_active,monitor_rollback,reason,result,
 legacy_api_id,legacy_web_id,legacy_api_image,legacy_web_image,legacy_api_restart,
 legacy_web_restart,legacy_api_running,legacy_web_running,legacy_api_quarantined,
 legacy_web_quarantined,legacy_api_removed,legacy_web_removed,legacy_maintenance,
 legacy_config,legacy_caddy_path,migration_base,migration_candidate,migration_status,migration_checked,
 migration_applied) = sys.argv[1:]
def maybe(v): return v or None
def flag(v): return v == '1'
def epoch(v): return int(v) if v.isdigit() else None
state = {
  'version': 2,
  'event': event,
  'updatedAt': datetime.now(timezone.utc).isoformat(),
  'activeSlot': maybe(active),
  'candidateSlot': maybe(candidate),
  'previousSlot': maybe(previous),
  'slots': {
    'blue': {'images': {'api': maybe(blue_api), 'web': maybe(blue_web)}},
    'green': {'images': {'api': maybe(green_api), 'web': maybe(green_web)}},
  },
  'gateway': {'mode': gateway_mode, 'slot': maybe(gateway_slot)},
  'stableUntil': epoch(stable),
  'monitor': {'activeSlot': maybe(monitor_active), 'rollbackSlot': maybe(monitor_rollback)},
  'migration': {
    'baseCommit': maybe(migration_base), 'candidateCommit': maybe(migration_candidate),
    'status': migration_status, 'checkedAt': maybe(migration_checked),
    'appliedAt': maybe(migration_applied),
  },
  'legacy': {
    'api': {'id': maybe(legacy_api_id), 'image': maybe(legacy_api_image),
            'restart': legacy_api_restart, 'wasRunning': flag(legacy_api_running),
            'quarantined': flag(legacy_api_quarantined), 'removed': flag(legacy_api_removed)},
    'web': {'id': maybe(legacy_web_id), 'image': maybe(legacy_web_image),
            'restart': legacy_web_restart, 'wasRunning': flag(legacy_web_running),
            'quarantined': flag(legacy_web_quarantined), 'removed': flag(legacy_web_removed),
            'maintenance': flag(legacy_maintenance)},
    'normalConfigB64': maybe(legacy_config),
    'caddyConfigPath': maybe(legacy_caddy_path),
  },
  'rollbackReason': maybe(reason),
  'result': maybe(result),
}
fd,tmp=tempfile.mkstemp(prefix='.pi5-blue-green-', dir=os.path.dirname(path))
with os.fdopen(fd,'w',encoding='utf-8') as f:
    json.dump(state,f,ensure_ascii=False,separators=(',',':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
os.replace(tmp,path)
PY
}

load_state_context() {
  state_assert
  eval "$(python3 - "$STATE_FILE" <<'PY'
import json, shlex, sys
with open(sys.argv[1], encoding='utf-8') as f:
    state = json.load(f)

def g(*keys, default=''):
    value = state
    for key in keys:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
        if value is None:
            return default
    if isinstance(value, bool):
        return '1' if value else '0'
    return '' if value is None else str(value)

slots = state.get('slots') or {}
blue = (slots.get('blue') or {}).get('images') or (slots.get('blue') or {})
green = (slots.get('green') or {}).get('images') or (slots.get('green') or {})
# Support both slots.blue.images.api and slots.blue.api shapes.
if 'api' in (slots.get('blue') or {}) and 'images' not in (slots.get('blue') or {}):
    blue = slots.get('blue') or {}
if 'api' in (slots.get('green') or {}) and 'images' not in (slots.get('green') or {}):
    green = slots.get('green') or {}
gateway = state.get('gateway') or {}
monitor = state.get('monitor') or {}
migration = state.get('migration') or {}
legacy = state.get('legacy') or {}
legacy_api = legacy.get('api') or {}
legacy_web = legacy.get('web') or {}

pairs = {
    'ACTIVE_SLOT': g('activeSlot'),
    'CANDIDATE_SLOT': g('candidateSlot'),
    'PREVIOUS_SLOT': g('previousSlot'),
    'BLUE_API_IMAGE': blue.get('api') or '',
    'BLUE_WEB_IMAGE': blue.get('web') or '',
    'GREEN_API_IMAGE': green.get('api') or '',
    'GREEN_WEB_IMAGE': green.get('web') or '',
    'GATEWAY_MODE': gateway.get('mode') or 'offline',
    'GATEWAY_SLOT': gateway.get('slot') or '',
    'STABLE_UNTIL': g('stableUntil'),
    'MONITOR_ACTIVE_SLOT': monitor.get('activeSlot') or '',
    'MONITOR_ROLLBACK_SLOT': monitor.get('rollbackSlot') or '',
    'MIGRATION_BASE_COMMIT': migration.get('baseCommit') or '',
    'MIGRATION_CANDIDATE_COMMIT': migration.get('candidateCommit') or '',
    'MIGRATION_STATUS': migration.get('status') or '',
    'MIGRATION_CHECKED_AT': migration.get('checkedAt') or '',
    'MIGRATION_APPLIED_AT': migration.get('appliedAt') or '',
    'LEGACY_API_ID': legacy_api.get('id') or '',
    'LEGACY_WEB_ID': legacy_web.get('id') or '',
    'LEGACY_API_IMAGE': legacy_api.get('image') or '',
    'LEGACY_WEB_IMAGE': legacy_web.get('image') or '',
    'LEGACY_API_RESTART': legacy_api.get('restart') or 'always',
    'LEGACY_WEB_RESTART': legacy_web.get('restart') or 'always',
    'LEGACY_API_WAS_RUNNING': '1' if legacy_api.get('wasRunning') else '0',
    'LEGACY_WEB_WAS_RUNNING': '1' if legacy_web.get('wasRunning') else '0',
    'LEGACY_API_QUARANTINED': '1' if legacy_api.get('quarantined') else '0',
    'LEGACY_WEB_QUARANTINED': '1' if legacy_web.get('quarantined') else '0',
    'LEGACY_API_REMOVED': '1' if legacy_api.get('removed') else '0',
    'LEGACY_WEB_REMOVED': '1' if legacy_web.get('removed') else '0',
    'LEGACY_WEB_MAINTENANCE': '1' if (legacy_web.get('maintenance') or legacy.get('webMaintenance')) else '0',
    'LEGACY_NORMAL_CONFIG_B64': legacy.get('normalConfigB64') or '',
    'LEGACY_CADDY_CONFIG_PATH': legacy.get('caddyConfigPath') or '',
}
for key, value in pairs.items():
    print(f'{key}={shlex.quote(str(value))}')
PY
)"
}

slot_api_image() { [[ "$1" == blue ]] && printf '%s\n' "$BLUE_API_IMAGE" || printf '%s\n' "$GREEN_API_IMAGE"; }
slot_web_image() { [[ "$1" == blue ]] && printf '%s\n' "$BLUE_WEB_IMAGE" || printf '%s\n' "$GREEN_WEB_IMAGE"; }

image_commit() {
  python3 - "$1" <<'PY'
import re, sys
matches=re.findall(r'(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])',sys.argv[1],re.I)
if len(matches) != 1: raise SystemExit(1)
print(matches[0].lower())
PY
}

validate_image_pair() {
  local api="$1" web="$2" api_commit web_commit
  # DRY_RUN lifecycle fixtures may use non-commit tags; still enforce pair equality
  # when both tags contain an immutable commit SHA.
  if api_commit="$(image_commit "$api" 2>/dev/null || true)" && web_commit="$(image_commit "$web" 2>/dev/null || true)"; then
    if [[ -n "$api_commit" && -n "$web_commit" ]]; then
      [[ "$api_commit" == "$web_commit" ]] || die 'API and Web images do not share the same immutable commit tag'
      return 0
    fi
  fi
  if [[ "$DRY_RUN" == 1 ]]; then
    return 0
  fi
  api_commit="$(image_commit "$api")" || die "API image tag is not an immutable commit/config tag: $api"
  web_commit="$(image_commit "$web")" || die "Web image tag is not an immutable commit/config tag: $web"
  [[ "$api_commit" == "$web_commit" ]] || die 'API and Web images do not share the same immutable commit tag'
}

resolve_images() {
  [[ -n "$API_IMAGE" ]] || API_IMAGE="$(python3 - "$PHASE2_STATE_FILE" 2>/dev/null <<'PY' || true
import json,sys
with open(sys.argv[1]) as f:s=json.load(f)
print((s.get('candidate') or {}).get('api') or '')
PY
)"
  [[ -n "$WEB_IMAGE" ]] || WEB_IMAGE="$(python3 - "$PHASE2_STATE_FILE" 2>/dev/null <<'PY' || true
import json,sys
with open(sys.argv[1]) as f:s=json.load(f)
print((s.get('candidate') or {}).get('web') or '')
PY
)"
  [[ -n "$API_IMAGE" && -n "$WEB_IMAGE" ]] || die 'candidate images are missing; pass --api-image and --web-image'
  validate_image_pair "$API_IMAGE" "$WEB_IMAGE"
  [[ "$DRY_RUN" == 1 ]] || docker image inspect "$API_IMAGE" "$WEB_IMAGE" >/dev/null || die 'candidate image is missing locally'
}

resource_value() {
  case "$1" in
    memory) [[ -n "${PI5_BLUE_GREEN_TEST_MEMORY_MB:-}" ]] && printf '%s\n' "$PI5_BLUE_GREEN_TEST_MEMORY_MB" || awk '/MemAvailable:/ {print int($2/1024); exit}' /proc/meminfo ;;
    disk) [[ -n "${PI5_BLUE_GREEN_TEST_DISK_GB:-}" ]] && printf '%s\n' "$PI5_BLUE_GREEN_TEST_DISK_GB" || df -Pk "$PROJECT_DIR" | awk 'NR==2 {print int($4/1024/1024); exit}' ;;
    load) [[ -n "${PI5_BLUE_GREEN_TEST_LOAD_AVG:-}" ]] && printf '%s\n' "$PI5_BLUE_GREEN_TEST_LOAD_AVG" || awk '{print $1; exit}' /proc/loadavg ;;
  esac
}

resource_guard() {
  [[ "${PI5_BLUE_GREEN_SKIP_RESOURCE_GUARD:-0}" == 1 ]] && return 0
  local memory disk load max_load cpu_count
  memory="$(resource_value memory)"; disk="$(resource_value disk)"; load="$(resource_value load)"
  [[ "$memory" =~ ^[0-9]+$ ]] || die 'available memory could not be read'
  [[ "$disk" =~ ^[0-9]+$ ]] || die 'free disk could not be read'
  [[ "$load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'load average could not be read'
  if [[ -n "$MAX_LOAD_AVG" ]]; then
    max_load="$MAX_LOAD_AVG"
  else
    cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || true)"
    [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]] || die 'online CPU count could not be read'
    max_load="$(awk "BEGIN {printf \"%.2f\", $cpu_count * 0.75}")"
  fi
  [[ "$max_load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'maximum load average is invalid'
  awk "BEGIN {exit !($load < $max_load)}" || die "load average ${load} is not below ${max_load}"
  ((memory >= MIN_MEMORY_MB)) || die "available memory ${memory}MB is below ${MIN_MEMORY_MB}MB; use Phase 2"
  ((disk >= MIN_DISK_GB)) || die "free disk ${disk}GB is below ${MIN_DISK_GB}GB; use Phase 2"
  log "resource gate passed: memory=${memory}MB disk=${disk}GB load=${load}/${max_load}"
}

secret_guard() {
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  python3 - "$ENV_FILE" <<'PY' || die 'JWT secrets are empty, replace-me, or weak; refusing candidate start'
import re,sys
values={}
with open(sys.argv[1],encoding='utf-8') as f:
  for raw in f:
    line=raw.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); values[k.strip()]=v.strip().strip('"').strip("'")
# Placeholder/weak patterns only — do not treat the substring "secret" inside a strong value as weak.
weak=re.compile(r'(change[-_]?me|replace[-_]?me|example|password|^secret$|test[-_]|dev[-_])',re.I)
for key in ('JWT_ACCESS_SECRET','JWT_REFRESH_SECRET'):
  value=values.get(key,'')
  if len(value)<32 or weak.search(value): raise SystemExit(f'{key} is weak')
if values['JWT_ACCESS_SECRET']==values['JWT_REFRESH_SECRET']:
  raise SystemExit('JWT secrets must differ')
PY
}

compose_current() {
  local ba="$BLUE_API_IMAGE" ga="$GREEN_API_IMAGE" bw="$BLUE_WEB_IMAGE" gw="$GREEN_WEB_IMAGE" gateway
  [[ -n "$ba" ]] || ba="${API_IMAGE:-unused-api}"
  [[ -n "$ga" ]] || ga="$ba"
  [[ -n "$bw" ]] || bw="${WEB_IMAGE:-unused-web}"
  [[ -n "$gw" ]] || gw="$bw"
  gateway="$(slot_web_image "${GATEWAY_SLOT:-blue}")"; [[ -n "$gateway" ]] || gateway="$bw"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf 'DRY-RUN: docker compose -p %q -f %q' "$COMPOSE_PROJECT" "$PHASE3_COMPOSE"; printf ' %q' "$@"; printf '\n'
    return 0
  fi
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  PI5_PROJECT_DIR="$PROJECT_DIR" PI5_ENV_FILE="$ENV_FILE" PI5_BLUE_GREEN_CONFIG_DIR="$CONFIG_DIR" \
    PI5_BLUE_API_IMAGE="$ba" PI5_GREEN_API_IMAGE="$ga" PI5_BLUE_WEB_IMAGE="$bw" \
    PI5_GREEN_WEB_IMAGE="$gw" PI5_GATEWAY_IMAGE="$gateway" \
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$PHASE3_COMPOSE" "$@"
}

legacy_compose() {
  [[ "$DRY_RUN" == 1 ]] && { printf 'DRY-RUN: legacy compose'; printf ' %q' "$@"; printf '\n'; return 0; }
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" "$@"
}

legacy_compose_restore() {
  local restore_override="${PROJECT_DIR}/infrastructure/docker/docker-compose.legacy-restore.yml"
  [[ "$DRY_RUN" == 1 ]] && { printf 'DRY-RUN: legacy restore compose'; printf ' %q' "$@"; printf '\n'; return 0; }
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  [[ -n "$LEGACY_API_IMAGE" && -n "$LEGACY_WEB_IMAGE" ]] || die 'legacy restore requires captured LEGACY_*_IMAGE values'
  [[ -f "$restore_override" ]] || die "legacy restore override is missing: $restore_override"
  PI5_LEGACY_API_IMAGE="$LEGACY_API_IMAGE" PI5_LEGACY_WEB_IMAGE="$LEGACY_WEB_IMAGE" \
    docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$restore_override" "$@"
}

render_gateway() {
  local mode="$1" slot="${2:-}" template api web
  if [[ "$mode" == maintenance ]]; then
    template="$GATEWAY_MAINTENANCE_TEMPLATE"
    if [[ ! -f "$template" ]]; then
      if [[ "$HTTP_ONLY" == 1 ]]; then
        template="${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.http"
      else
        template="${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.production"
      fi
    fi
    api='maintenance'; web='maintenance'
  else
    is_slot "$slot" || die 'application gateway render requires a slot'
    template="$GATEWAY_TEMPLATE"; [[ "$HTTP_ONLY" == 1 ]] && template="$GATEWAY_HTTP_TEMPLATE"
    api="api-${slot}:8080"; web="web-${slot}:80"
  fi
  [[ -f "$template" ]] || die "gateway template is missing: $template"
  mkdir -p "$CONFIG_DIR"
  python3 - "$template" "$CONFIG_DIR/Caddyfile" "$api" "$web" <<'PY'
import os,sys,tempfile
template,destination,api,web=sys.argv[1:]
with open(template,encoding='utf-8') as f: content=f.read()
content=content.replace('__BLUE_GREEN_API_UPSTREAM__',api).replace('__BLUE_GREEN_WEB_UPSTREAM__',web)
fd,tmp=tempfile.mkstemp(prefix='.Caddyfile-',dir=os.path.dirname(destination),text=True)
with os.fdopen(fd,'w',encoding='utf-8') as f: f.write(content); f.flush(); os.fsync(f.fileno())
os.replace(tmp,destination)
PY
  log "gateway config rendered: mode=${mode} slot=${slot:-none}"
}

gateway_config_validate() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local cid; cid="$(compose_current ps -q gateway 2>/dev/null || true)"
  if [[ -n "$cid" ]]; then docker exec "$cid" caddy validate --config /srv/bluegreen/Caddyfile >/dev/null; else return 0; fi
}

# A failed bootstrap stops the gateway. Reusing that stopped container leaves
# its Docker port publication/network endpoint stale on Pi5, even though Caddy
# starts inside it. Always create a fresh fixed-port owner for a new handoff.
gateway_start() { [[ "$DRY_RUN" == 1 ]] && return 0; compose_current up -d --force-recreate gateway; }
gateway_reload() { [[ "$DRY_RUN" == 1 ]] && return 0; compose_current exec -T gateway caddy reload --config /srv/bluegreen/Caddyfile; }
gateway_smoke_url() {
  local url="$1" attempt
  [[ "$DRY_RUN" == 1 ]] && return 0
  for attempt in $(seq 1 "$GATEWAY_READY_RETRIES"); do
    if curl -kfsS --max-time 5 "$url" >/dev/null; then return 0; fi
    sleep "$GATEWAY_READY_INTERVAL"
  done
  return 1
}
maintenance_smoke() { gateway_smoke_url "$WEB_URL"; }
external_smoke() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  gateway_smoke_url "$API_HEALTH_URL" || return 1
  gateway_smoke_url "$WEB_URL" || return 1
  [[ -z "$KIOSK_HEALTH_URL" ]] || gateway_smoke_url "$KIOSK_HEALTH_URL" || return 1
}
gateway_points_to() {
  local slot="$1"
  [[ -f "$CONFIG_DIR/Caddyfile" ]] || return 1
  grep -Fq "api-${slot}:8080" "$CONFIG_DIR/Caddyfile" && grep -Fq "web-${slot}:80" "$CONFIG_DIR/Caddyfile"
}

ensure_gateway_maintenance() {
  render_gateway maintenance || return 1
  gateway_config_validate || return 1
  if [[ "$DRY_RUN" == 1 ]]; then return 0; fi
  if [[ -z "$(compose_current ps -q gateway 2>/dev/null || true)" ]]; then gateway_start || return 1
  else gateway_reload || gateway_start || return 1
  fi
  maintenance_smoke || return 1
}

slot_container_id() { compose_current ps -q "$1" 2>/dev/null || true; }
docker_running() { [[ "$DRY_RUN" == 1 ]] && return 0; [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == true ]]; }
container_image() { [[ "$DRY_RUN" == 1 ]] && printf 'dry-run-image\n' || docker inspect -f '{{.Config.Image}}' "$1"; }
verify_slot_identity() {
  local slot="$1" api_id web_id
  [[ "$DRY_RUN" == 1 ]] && return 0
  api_id="$(slot_container_id "api-${slot}")"; web_id="$(slot_container_id "web-${slot}")"
  [[ -n "$api_id" && -n "$web_id" ]] || return 1
  [[ "$(container_image "$api_id")" == "$(slot_api_image "$slot")" ]] || return 1
  [[ "$(container_image "$web_id")" == "$(slot_web_image "$slot")" ]]
}

scheduler_readiness() {
  local slot="$1" expected_role="$2" cid
  [[ "$DRY_RUN" == 1 ]] && return 0
  cid="$(slot_container_id "api-${slot}")"; [[ -n "$cid" ]] || return 1
  docker exec "$cid" node - "$expected_role" <<'JS'
const role=process.argv[2];
fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal')
 .then(async response => {
   const body=await response.json().catch(()=>null);
   const scheduler=body && body.scheduler;
   const ok=response.ok && body && body.ready===true && body.database==='ready' &&
     scheduler && scheduler.enabled===true && scheduler.role===role &&
     scheduler.databaseConnection==='connected';
   process.exit(ok?0:1);
 }).catch(()=>process.exit(1));
JS
}

slot_runtime_ready() {
  local slot="$1" role="$2" attempt
  [[ "$DRY_RUN" == 1 ]] && return 0
  for attempt in $(seq 1 "$READINESS_RETRIES"); do
    verify_slot_identity "$slot" && scheduler_readiness "$slot" "$role" && return 0
    sleep "$READINESS_INTERVAL"
  done
  return 1
}

slot_web_validate() {
  local slot="$1" cid
  [[ "$DRY_RUN" == 1 ]] && return 0
  cid="$(slot_container_id "web-${slot}")"; [[ -n "$cid" ]] || return 1
  docker exec "$cid" caddy validate --config /srv/Caddyfile.slot >/dev/null
}

slot_ready() {
  local slot="$1" role="$2"
  slot_runtime_ready "$slot" "$role" && slot_web_validate "$slot"
}

slot_up() {
  local slot="$1" role="$2"
  compose_current up -d "api-${slot}" "web-${slot}" || return 1
  slot_ready "$slot" "$role"
}

legacy_service_id() { legacy_compose ps -q "$1" 2>/dev/null || true; }
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
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_WEB_REMOVED=1; return 0; }
  docker stop "$LEGACY_WEB_ID" >/dev/null || return 1
  docker rm "$LEGACY_WEB_ID" >/dev/null || return 1
  LEGACY_WEB_REMOVED=1
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
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_API_QUARANTINED=0; LEGACY_WEB_QUARANTINED=0; LEGACY_WEB_MAINTENANCE=0; return 0; }
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
  if ((rc == 0)); then LEGACY_API_QUARANTINED=0; LEGACY_WEB_QUARANTINED=0; LEGACY_WEB_MAINTENANCE=0; fi
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

migration_guard() {
  local base_image="$1" candidate_image="$2" base_ref candidate_ref
  if [[ "$DRY_RUN" == 1 ]]; then
    MIGRATION_BASE_COMMIT="$(image_commit "$base_image" 2>/dev/null || true)"
    MIGRATION_CANDIDATE_COMMIT="$(image_commit "$candidate_image" 2>/dev/null || true)"
    MIGRATION_STATUS=checked
    MIGRATION_CHECKED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    MIGRATION_APPLIED_AT=''
    return 0
  fi
  candidate_ref="$(image_commit "$candidate_image")" || die 'candidate image tag is not an immutable commit/config tag'
  base_ref="${MIGRATION_BASE_REF:-}"; [[ -n "$base_ref" ]] || base_ref="$(image_commit "$base_image" || true)"
  MIGRATION_BASE_COMMIT="$base_ref"; MIGRATION_CANDIDATE_COMMIT="$candidate_ref"
  MIGRATION_STATUS=checked; MIGRATION_CHECKED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"; MIGRATION_APPLIED_AT=''
  [[ "$base_ref" =~ ^[0-9a-f]{40}$ ]] || die 'migration base commit is unknown'
  git -C "$PROJECT_DIR" cat-file -e "${base_ref}^{commit}" 2>/dev/null || die "migration base commit unavailable: $base_ref"
  git -C "$PROJECT_DIR" cat-file -e "${candidate_ref}^{commit}" 2>/dev/null || die "candidate commit unavailable: $candidate_ref"
  local changed=() modified
  while IFS= read -r migration; do [[ -n "$migration" ]] && changed+=("$PROJECT_DIR/$migration"); done < <(
    git -C "$PROJECT_DIR" diff --diff-filter=A --name-only "$base_ref" "$candidate_ref" -- 'apps/api/prisma/migrations/*/migration.sql'
  )
  modified="$(git -C "$PROJECT_DIR" diff --diff-filter=M --name-only "$base_ref" "$candidate_ref" -- 'apps/api/prisma/migrations/*/migration.sql' || true)"
  [[ -z "$modified" ]] || die 'modified existing migrations are not Expand-only; release refused'
  ((${#changed[@]} == 0)) && return 0
  python3 - "${changed[@]}" <<'PY' || die 'migration SQL is outside the Expand-only allow-list'
import re,sys
allowed=re.compile(r'^\s*(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|TYPE|EXTENSION|SEQUENCE|SCHEMA|ENUM)\b|ALTER\s+TABLE\b[\s\S]*?\bADD\s+(COLUMN|CONSTRAINT)\b|COMMENT\s+ON\b)',re.I)
forbidden=re.compile(r'\b(DROP|RENAME|SET\s+NOT\s+NULL|ALTER\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b',re.I)
for path in sys.argv[1:]:
 text=open(path,encoding='utf-8').read(); text=re.sub(r'--.*?$','',text,flags=re.M); text=re.sub(r'/\*.*?\*/','',text,flags=re.S)
 for raw in text.split(';'):
  stmt=raw.strip()
  if stmt and (not allowed.match(stmt) or forbidden.search(stmt)): raise SystemExit(f'disallowed statement in {path}: {stmt[:120]}')
PY
}

migration_apply_and_verify() {
  local candidate="$1" base_image="$2" compatibility_slot="$3"
  migration_guard "$base_image" "$(slot_api_image "$candidate")" || return 1
  if [[ "$DRY_RUN" != 1 ]]; then
    # The API image has `node dist/main.js` as its default command.  Use an
    # explicit shell and the installed Prisma binary so Compose does not try to
    # execute `npx` through that Node command during bootstrap/prepare.
    compose_current run --rm --no-deps "api-${candidate}" sh -lc './node_modules/.bin/prisma migrate status' || return 1
    compose_current run --rm --no-deps "api-${candidate}" sh -lc './node_modules/.bin/prisma migrate deploy' || return 1
    compose_current run --rm --no-deps "api-${candidate}" sh -lc './node_modules/.bin/prisma migrate status' || return 1
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
  local slot api_image web_image
  for slot in "$@"; do
    is_slot "$slot" || die "invalid state slot while validating images: ${slot}"
    api_image="$(slot_api_image "$slot")"; web_image="$(slot_web_image "$slot")"
    [[ -n "$api_image" && -n "$web_image" ]] || die "state has incomplete ${slot} image pair; refusing compose up"
    validate_image_pair "$api_image" "$web_image"
    [[ "$DRY_RUN" == 1 ]] || docker image inspect "$api_image" "$web_image" >/dev/null || die "state image pair is unavailable locally for ${slot}; refusing compose up"
  done
}

arm_bootstrap_recovery() {
  BOOTSTRAP_RECOVERY_ARMED=1
  trap 'rc=$?; if ((BOOTSTRAP_RECOVERY_ARMED==1)); then bootstrap_failure "unexpected bootstrap exit (${rc})"; fi' ERR
  trap 'if ((BOOTSTRAP_RECOVERY_ARMED==1)); then bootstrap_failure "bootstrap interrupted by signal"; fi' INT TERM HUP
}
disarm_bootstrap_recovery() { BOOTSTRAP_RECOVERY_ARMED=0; trap - ERR INT TERM HUP; }

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
  if [[ -f "$STATE_FILE" ]]; then state_assert; [[ "$(state_get event)" == bootstrap-failed ]] || die 'Blue/Green state already exists; use reconcile or status'; fi
  resolve_images; resource_guard; secret_guard
  BLUE_API_IMAGE="$API_IMAGE"; BLUE_WEB_IMAGE="$WEB_IMAGE"; GREEN_API_IMAGE=''; GREEN_WEB_IMAGE=''
  ACTIVE_SLOT=''; CANDIDATE_SLOT=blue; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''
  render_gateway maintenance; gateway_config_validate
  legacy_capture || die 'legacy API/Web containers are missing; bootstrap refused'
  ((LEGACY_API_WAS_RUNNING == 1 && LEGACY_WEB_WAS_RUNNING == 1)) || die 'legacy API/Web must both be running before bootstrap'
  assert_legacy_port_ownership || die '80/443 are not owned exclusively by legacy Web'
  legacy_scheduler_readiness || die 'legacy API is not a healthy scheduler leader'
  migration_apply_and_verify blue "$LEGACY_API_IMAGE" legacy || { MIGRATION_STATUS=failed; die 'candidate migration or compatibility failed'; }
  slot_up blue standby || { phase3_stop_for_recovery || true; die 'Blue candidate did not become scheduler standby'; }
  arm_bootstrap_recovery
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
  state_save active blue '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' application blue '' '' '' '' bootstrap-success
  disarm_bootstrap_recovery
  log 'Blue/Green bootstrap completed; blue is active and legacy services are quarantined'
}

prepare() {
  require_active_state; require_no_stability_window; resource_guard; secret_guard; resolve_images
  verify_slot_identity "$ACTIVE_SLOT" || die 'active slot image does not match state; run reconcile'
  slot_runtime_ready "$ACTIVE_SLOT" leader || die 'active slot is not a healthy scheduler leader'
  local candidate; candidate="$(other_slot "$ACTIVE_SLOT")"
  if [[ "$candidate" == blue ]]; then BLUE_API_IMAGE="$API_IMAGE"; BLUE_WEB_IMAGE="$WEB_IMAGE"; else GREEN_API_IMAGE="$API_IMAGE"; GREEN_WEB_IMAGE="$WEB_IMAGE"; fi
  migration_apply_and_verify "$candidate" "$(slot_api_image "$ACTIVE_SLOT")" "$ACTIVE_SLOT" || { MIGRATION_STATUS=failed; die 'candidate migration or compatibility failed'; }
  slot_up "$candidate" standby || { alert ERROR "candidate ${candidate} readiness failed"; die 'candidate slot is not a healthy scheduler standby'; }
  CANDIDATE_SLOT="$candidate"
  state_save prepared "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' candidate-prepared
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
  verify_slot_identity "$previous" && verify_slot_identity "$candidate" || die 'slot images do not match durable state'
  slot_runtime_ready "$previous" leader || die 'previous slot is not scheduler leader'
  slot_ready "$candidate" standby || die 'candidate is not scheduler standby'
  started="$(date +%s)"
  state_save switching "$previous" "$candidate" "$previous" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$previous" '' '' '' '' switching
  render_gateway application "$candidate" && gateway_config_validate && gateway_reload && gateway_points_to "$candidate" && external_smoke || { rollback_internal "$previous" "$candidate" 'gateway or external smoke failed' || true; die 'switch failed'; }
  now="$(date +%s)"; stable=$((now + STABLE_SECONDS))
  ACTIVE_SLOT="$candidate"; CANDIDATE_SLOT="$previous"; PREVIOUS_SLOT="$previous"
  STABLE_UNTIL="$stable"; MONITOR_ACTIVE_SLOT="$candidate"; MONITOR_ROLLBACK_SLOT="$previous"; GATEWAY_SLOT="$candidate"
  if ! state_save active "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" '' "success:$((now-started))s"; then
    alert CRITICAL 'gateway switched but durable state save failed; attempting rollback to previous slot'
    if ! rollback_internal "$previous" "$candidate" 'post-switch state save failed'; then
      alert CRITICAL 'rollback after state-save failure also failed; moving gateway to maintenance'
      ensure_gateway_maintenance || alert CRITICAL 'post-switch failure left gateway state unproven'
    fi
    die 'switch failed after gateway cutover because durable state could not be saved'
  fi
  log "switch completed; ${candidate} is public standby and ${previous} remains scheduler leader until ${stable}"
  spawn_stability_monitor
}

rollback() {
  require_active_state
  is_slot "$PREVIOUS_SLOT" || die 'no previous slot is recorded'
  rollback_internal "$PREVIOUS_SLOT" "$ACTIVE_SLOT" "${ROLLBACK_REASON:-manual rollback}" || { alert CRITICAL 'manual rollback failed; routing left unchanged'; die 'manual rollback failed'; }
}

monitor_checks() {
  local active="$1" rollback_slot="$2" samples="$3" error_rate
  slot_ready "$active" standby || return 1
  slot_runtime_ready "$rollback_slot" leader || return 1
  external_smoke || return 1
  if [[ -n "$ERROR_RATE_URL" && "$samples" -ge "$MIN_ERROR_SAMPLES" && "$DRY_RUN" != 1 ]]; then
    error_rate="$(curl -kfsS --max-time 5 "$ERROR_RATE_URL" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(float(d.get("errorRate",d.get("error_rate",1))))')" || return 1
    awk "BEGIN {exit !($error_rate <= $MAX_ERROR_RATE)}" || return 1
  fi
}

monitor() {
  [[ -f "$STATE_FILE" ]] || return 0
  local deadline active rollback_slot samples=0
  while :; do
    load_state_context
    deadline="$STABLE_UNTIL"; active="$MONITOR_ACTIVE_SLOT"; rollback_slot="$MONITOR_ROLLBACK_SLOT"
    [[ "$deadline" =~ ^[0-9]+$ ]] || return 0
    is_slot "$active" && is_slot "$rollback_slot" || return 0
    (( $(date +%s) < deadline )) || return 0
    samples=$((samples + 1))
    if ! monitor_checks "$active" "$rollback_slot" "$samples"; then
      alert CRITICAL "stability monitor failed for ${active}; attempting rollback"
      rollback_internal "$rollback_slot" "$active" 'automatic monitor threshold failure' || alert CRITICAL 'automatic rollback failed; routing unchanged'
      return 1
    fi
    sleep "$MONITOR_INTERVAL"
  done
}

spawn_stability_monitor() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ ]] || return 0
  (( $(date +%s) < STABLE_UNTIL )) || return 0
  is_slot "$MONITOR_ACTIVE_SLOT" && is_slot "$MONITOR_ROLLBACK_SLOT" || return 0
  nohup sh -c "sleep 1; exec '$SCRIPT_PATH' monitor" >>"${STATE_FILE}.monitor.log" 2>&1 &
  log "stability monitor (re)started until ${STABLE_UNTIL}"
}

cleanup_legacy() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_API_REMOVED=1; LEGACY_WEB_REMOVED=1; return 0; }
  local rc=0
  if ((LEGACY_API_REMOVED == 0)) && [[ -n "$LEGACY_API_ID" ]]; then docker rm "$LEGACY_API_ID" >/dev/null && LEGACY_API_REMOVED=1 || rc=1; fi
  if ((LEGACY_WEB_REMOVED == 0)) && [[ -n "$LEGACY_WEB_ID" ]]; then docker rm "$LEGACY_WEB_ID" >/dev/null && LEGACY_WEB_REMOVED=1 || rc=1; fi
  return "$rc"
}

cleanup() {
  require_active_state
  local now previous; now="$(date +%s)"; previous="$PREVIOUS_SLOT"
  is_slot "$previous" || { log 'no previous slot to clean'; return 0; }
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && "$now" -ge "$STABLE_UNTIL" ]] || die 'previous slot is still inside five-minute stability window'
  slot_ready "$ACTIVE_SLOT" standby || die 'public slot is not healthy standby before cleanup handoff'
  slot_runtime_ready "$previous" leader || die 'previous slot is not leader before cleanup handoff'
  compose_current stop "api-${previous}" || die 'could not stop previous leader API'
  slot_runtime_ready "$ACTIVE_SLOT" leader || { compose_current up -d "api-${previous}" || true; die 'new slot did not become leader; old slot retained/restored'; }
  compose_current stop "web-${previous}" || die 'could not stop previous Web'
  compose_current rm -f "api-${previous}" "web-${previous}" || die 'could not remove previous slot containers'
  PREVIOUS_SLOT=''; CANDIDATE_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  if ! cleanup_legacy; then
    alert ERROR 'legacy cleanup was partial; durable removed flags record the completed service removals'
    state_save cleanup-partial "$ACTIVE_SLOT" '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' legacy-cleanup-partial
    die 'legacy cleanup was partial; captured images remain available to legacy_compose_restore'
  fi
  state_save cleaned "$ACTIVE_SLOT" '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' cleanup-complete
  log "cleaned ${previous} slot; ${ACTIVE_SLOT} confirmed scheduler leader; old containers removed and images retained"
}

reconcile() {
  load_state_context
  local event; event="$(state_get event)"
  if ((RESTORE_LEGACY == 1)); then
    restore_legacy_after_phase3_stop || die 'legacy restore failed during reconcile; gateway maintenance was attempted'
    ACTIVE_SLOT=''; CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
    state_save legacy-restored '' '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" offline '' '' '' '' '' legacy-restored-by-operator
    alert WARNING 'legacy API/Web restored and Phase 3 services stopped by reconcile --restore-legacy'
    return 0
  fi
  if [[ "$event" == bootstrapping || "$event" == bootstrap-failed ]]; then
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
  local stale=0 slot expected
  load_state_context
  if [[ "$DRY_RUN" != 1 ]]; then
    for slot in blue green; do
      if [[ -n "$(slot_container_id "api-${slot}")" || -n "$(slot_container_id "web-${slot}")" ]]; then verify_slot_identity "$slot" || stale=1; fi
    done
    if [[ "$GATEWAY_MODE" == application ]] && is_slot "$GATEWAY_SLOT"; then gateway_points_to "$GATEWAY_SLOT" || stale=1; fi
  fi
  expected=leader
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -lt STABLE_UNTIL && -n "$PREVIOUS_SLOT" ]] && expected=standby
  python3 - "$STATE_FILE" "$stale" "$expected" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f:s=json.load(f)
s['runtimeStatus']='stale' if sys.argv[2]=='1' else 'consistent'
s['expectedActiveSchedulerRole']=sys.argv[3]
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
# Observation commands intentionally never hold the exclusive mutation lock.
# This keeps status and the five-minute monitor available during operator work.
mkdir -p "$(dirname "$LOCK_FILE")"
case "$COMMAND" in
  status|monitor) ;;
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
esac
