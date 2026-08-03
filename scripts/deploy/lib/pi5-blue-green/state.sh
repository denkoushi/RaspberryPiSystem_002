# shellcheck shell=bash
# Source-only schema-v2 state validation and atomic persistence helpers.

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
    image_ids = slots[name].get('imageIds')
    if image_ids is not None:
        if not isinstance(image_ids, dict) or set(image_ids) != {'api','web'}:
            raise SystemExit(f'Blue/Green state has malformed {name} image IDs')
        values = (image_ids.get('api'), image_ids.get('web'))
        if any(value is not None and not isinstance(value, str) for value in values):
            raise SystemExit(f'Blue/Green state has malformed {name} image IDs')
        if any(value is not None and not __import__('re').fullmatch(r'sha256:[0-9a-f]{64}', value) for value in values):
            raise SystemExit(f'Blue/Green state has malformed {name} image IDs')
        if (values[0] is None) != (values[1] is None):
            raise SystemExit(f'Blue/Green state has partial {name} image IDs')
retired = s.get('retiredImages')
if retired is not None:
    if not isinstance(retired, dict) or set(retired) != {'images', 'imageIds'}:
        raise SystemExit('Blue/Green state has malformed retired image ownership')
    images, image_ids = retired.get('images'), retired.get('imageIds')
    if (not isinstance(images, dict) or set(images) != {'api', 'web'}
            or not isinstance(image_ids, dict) or set(image_ids) != {'api', 'web'}):
        raise SystemExit('Blue/Green state has malformed retired image pair')
    tag_pattern = __import__('re').compile(
        r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}:'
        r'[0-9a-f]{40}-[0-9a-f]{12}-[0-9a-f]{64}$'
    )
    if any(not isinstance(images.get(key), str) or tag_pattern.fullmatch(images[key]) is None
           for key in ('api', 'web')):
        raise SystemExit('Blue/Green state has unsafe retired image tag')
    if any(not isinstance(image_ids.get(key), str)
           or __import__('re').fullmatch(r'sha256:[0-9a-f]{64}', image_ids[key]) is None
           for key in ('api', 'web')):
        raise SystemExit('Blue/Green state has unsafe retired image ID')
release = s.get('releaseEvidence')
if release is not None:
    if not isinstance(release, dict) or set(release) != {'runId','desiredSha','resourceEvidence'}:
        raise SystemExit('Blue/Green state has malformed release evidence')
    resource = release.get('resourceEvidence')
    if (not isinstance(release.get('runId'), str)
            or not __import__('re').fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{2,79}', release['runId'])
            or not isinstance(release.get('desiredSha'), str)
            or not __import__('re').fullmatch(r'[0-9a-f]{40}', release['desiredSha'])
            or not isinstance(resource, dict) or set(resource) != {'path','sha256'}
            or not isinstance(resource.get('path'), str) or not resource['path'].startswith('/')
            or not isinstance(resource.get('sha256'), str)
            or not __import__('re').fullmatch(r'sha256:[0-9a-f]{64}', resource['sha256'])):
        raise SystemExit('Blue/Green state has malformed release evidence')
for key in ('legacy','monitor','migration','gateway'):
    if not isinstance(s.get(key), dict):
        raise SystemExit(f'Blue/Green state has malformed {key} metadata')
legacy_path = s['legacy'].get('caddyConfigPath')
if legacy_path not in (None, '/srv/Caddyfile', '/srv/Caddyfile.local', '/srv/Caddyfile.production'):
    raise SystemExit('Blue/Green state has an unsafe legacy Caddyfile path')
for service in ('api', 'web'):
    legacy_service = s['legacy'].get(service)
    if not isinstance(legacy_service, dict):
        raise SystemExit(f'Blue/Green state has malformed legacy {service} metadata')
    for field in ('removed', 'removeIntent'):
        value = legacy_service.get(field, False)
        if not isinstance(value, bool):
            raise SystemExit(f'Blue/Green state has malformed legacy {service} {field}')
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
    "$LEGACY_API_REMOVE_INTENT" "$LEGACY_WEB_REMOVE_INTENT" "$LEGACY_WEB_MAINTENANCE" \
    "$LEGACY_NORMAL_CONFIG_B64" "$LEGACY_CADDY_CONFIG_PATH" "$MIGRATION_BASE_COMMIT" \
    "$MIGRATION_CANDIDATE_COMMIT" "$MIGRATION_STATUS" "$MIGRATION_CHECKED_AT" "$MIGRATION_APPLIED_AT" \
    "$BLUE_API_IMAGE_ID" "$BLUE_WEB_IMAGE_ID" "$GREEN_API_IMAGE_ID" "$GREEN_WEB_IMAGE_ID" \
    "$RELEASE_RUN_ID" "$RELEASE_DESIRED_SHA" "$RELEASE_RESOURCE_EVIDENCE" \
    "$RELEASE_RESOURCE_EVIDENCE_SHA256" "$RETIRED_API_IMAGE" "$RETIRED_WEB_IMAGE" \
    "$RETIRED_API_IMAGE_ID" "$RETIRED_WEB_IMAGE_ID" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
(path,event,active,candidate,previous,blue_api,blue_web,green_api,green_web,
 gateway_mode,gateway_slot,stable,monitor_active,monitor_rollback,reason,result,
 legacy_api_id,legacy_web_id,legacy_api_image,legacy_web_image,legacy_api_restart,
 legacy_web_restart,legacy_api_running,legacy_web_running,legacy_api_quarantined,
 legacy_web_quarantined,legacy_api_removed,legacy_web_removed,legacy_api_remove_intent,
 legacy_web_remove_intent,legacy_maintenance,
 legacy_config,legacy_caddy_path,migration_base,migration_candidate,migration_status,migration_checked,
 migration_applied,blue_api_id,blue_web_id,green_api_id,green_web_id,release_run_id,
 release_sha,resource_evidence,resource_evidence_sha256,retired_api,retired_web,
 retired_api_id,retired_web_id) = sys.argv[1:]
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
    'blue': {
      'images': {'api': maybe(blue_api), 'web': maybe(blue_web)},
      'imageIds': {'api': maybe(blue_api_id), 'web': maybe(blue_web_id)},
    },
    'green': {
      'images': {'api': maybe(green_api), 'web': maybe(green_web)},
      'imageIds': {'api': maybe(green_api_id), 'web': maybe(green_web_id)},
    },
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
            'quarantined': flag(legacy_api_quarantined), 'removed': flag(legacy_api_removed),
            'removeIntent': flag(legacy_api_remove_intent)},
    'web': {'id': maybe(legacy_web_id), 'image': maybe(legacy_web_image),
            'restart': legacy_web_restart, 'wasRunning': flag(legacy_web_running),
            'quarantined': flag(legacy_web_quarantined), 'removed': flag(legacy_web_removed),
            'removeIntent': flag(legacy_web_remove_intent),
            'maintenance': flag(legacy_maintenance)},
    'normalConfigB64': maybe(legacy_config),
    'caddyConfigPath': maybe(legacy_caddy_path),
  },
  'rollbackReason': maybe(reason),
  'result': maybe(result),
}
if retired_api or retired_web or retired_api_id or retired_web_id:
  state['retiredImages'] = {
    'images': {'api': maybe(retired_api), 'web': maybe(retired_web)},
    'imageIds': {'api': maybe(retired_api_id), 'web': maybe(retired_web_id)},
  }
if release_run_id or release_sha or resource_evidence or resource_evidence_sha256:
  state['releaseEvidence'] = {
    'runId': release_run_id,
    'desiredSha': release_sha,
    'resourceEvidence': {'path': resource_evidence, 'sha256': resource_evidence_sha256},
  }
fd,tmp=tempfile.mkstemp(prefix='.pi5-blue-green-', dir=os.path.dirname(path))
with os.fdopen(fd,'w',encoding='utf-8') as f:
    json.dump(state,f,ensure_ascii=False,separators=(',',':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
os.replace(tmp,path)
os.chmod(path,0o600)
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
blue_ids = (slots.get('blue') or {}).get('imageIds') or {}
green_ids = (slots.get('green') or {}).get('imageIds') or {}
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
release = state.get('releaseEvidence') or {}
resource_evidence = release.get('resourceEvidence') or {}
retired = state.get('retiredImages') or {}
retired_images = retired.get('images') or {}
retired_ids = retired.get('imageIds') or {}

pairs = {
    'ACTIVE_SLOT': g('activeSlot'),
    'CANDIDATE_SLOT': g('candidateSlot'),
    'PREVIOUS_SLOT': g('previousSlot'),
    'BLUE_API_IMAGE': blue.get('api') or '',
    'BLUE_WEB_IMAGE': blue.get('web') or '',
    'GREEN_API_IMAGE': green.get('api') or '',
    'GREEN_WEB_IMAGE': green.get('web') or '',
    'BLUE_API_IMAGE_ID': blue_ids.get('api') or '',
    'BLUE_WEB_IMAGE_ID': blue_ids.get('web') or '',
    'GREEN_API_IMAGE_ID': green_ids.get('api') or '',
    'GREEN_WEB_IMAGE_ID': green_ids.get('web') or '',
    'RETIRED_API_IMAGE': retired_images.get('api') or '',
    'RETIRED_WEB_IMAGE': retired_images.get('web') or '',
    'RETIRED_API_IMAGE_ID': retired_ids.get('api') or '',
    'RETIRED_WEB_IMAGE_ID': retired_ids.get('web') or '',
    'RELEASE_RUN_ID': release.get('runId') or '',
    'RELEASE_DESIRED_SHA': release.get('desiredSha') or '',
    'RELEASE_RESOURCE_EVIDENCE': resource_evidence.get('path') or '',
    'RELEASE_RESOURCE_EVIDENCE_SHA256': resource_evidence.get('sha256') or '',
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
    'LEGACY_API_REMOVE_INTENT': '1' if legacy_api.get('removeIntent') else '0',
    'LEGACY_WEB_REMOVE_INTENT': '1' if legacy_web.get('removeIntent') else '0',
    'LEGACY_WEB_MAINTENANCE': '1' if (legacy_web.get('maintenance') or legacy.get('webMaintenance')) else '0',
    'LEGACY_NORMAL_CONFIG_B64': legacy.get('normalConfigB64') or '',
    'LEGACY_CADDY_CONFIG_PATH': legacy.get('caddyConfigPath') or '',
}
for key, value in pairs.items():
    print(f'{key}={shlex.quote(str(value))}')
PY
)"
}

