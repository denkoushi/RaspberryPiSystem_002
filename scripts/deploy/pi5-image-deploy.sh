#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
BASE_COMPOSE="${PI5_BASE_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
PHASE2_COMPOSE="${PI5_PHASE2_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase2.yml}"
ENV_FILE="${PI5_ENV_FILE:-${PROJECT_DIR}/infrastructure/docker/.env}"
STATE_FILE="${PI5_DEPLOY_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-image-deploy-state.json}"
BLUE_GREEN_STATE_FILE="${PI5_BLUE_GREEN_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json}"
LOCK_FILE="${PI5_DEPLOY_LOCK_FILE:-${PROJECT_DIR}/logs/.pi5-image-deploy.lock}"
API_REPOSITORY="${PI5_API_IMAGE_REPOSITORY:-raspi-system-api}"
WEB_REPOSITORY="${PI5_WEB_IMAGE_REPOSITORY:-raspi-system-web}"
HEALTH_URL="${PI5_HEALTH_URL:-https://127.0.0.1/api/system/health}"
WEB_URL="${PI5_WEB_URL:-https://127.0.0.1/}"
MAINTENANCE_URL="${PI5_MAINTENANCE_URL:-https://127.0.0.1/}"
MIN_FREE_MEMORY_MB="${PI5_CANDIDATE_EVIDENCE_MIN_MEMORY_MB:-${PI5_MIN_FREE_MEMORY_MB:-768}}"
MIN_FREE_DISK_GB="${PI5_CANDIDATE_EVIDENCE_MIN_DISK_GB:-${PI5_MIN_FREE_DISK_GB:-10}}"
MAX_LOAD_AVG="${PI5_CANDIDATE_MAX_LOAD_AVG:-}"
LOAD_SAMPLE_COUNT="${PI5_CANDIDATE_LOAD_SAMPLE_COUNT:-3}"
LOAD_SAMPLE_INTERVAL_SECONDS="${PI5_CANDIDATE_LOAD_SAMPLE_INTERVAL_SECONDS:-20}"
LOAD_WAIT_SECONDS="${PI5_CANDIDATE_LOAD_WAIT_SECONDS:-180}"
EVIDENCE_TTL_SECONDS="${PI5_CANDIDATE_EVIDENCE_TTL_SECONDS:-300}"
DRY_RUN="${PI5_DEPLOY_DRY_RUN:-0}"
REF=""
RUN_ID=""
RESOURCE_EVIDENCE_FILE=""
LAST_MEMORY_MB=""
LAST_DISK_GB=""
LAST_LOAD_SAMPLES='[]'
SIGNAGE_PAUSED=0
SIGNAGE_CONTAINER_ID=""
SIGNAGE_CONTROL_EVENTS='[]'
SIGNAGE_RESUME_REQUIRED=""
PREPARE_ACTIVE=0
PREPARE_API=""
PREPARE_WEB=""
BUILD_CONTEXT=""
BUILD_OVERRIDE=""
BUILD_ARGS_FILE=""
BUILD_ARGS_RENDER_FILE=""
SEALED_CONFIG_HASH=""
CANDIDATE_CONTAINER_ID=""
CANDIDATE_CONTAINER_NAME=""
SIGNAGE_PAUSE_OWNER_FILE="${STATE_FILE}.signage-pause-owner.json"
LOCK_DIR=""
LOCK_DIR_ACQUIRED=0

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
run() {
  if [[ "$DRY_RUN" == "1" ]]; then printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

usage() {
  cat <<'EOF'
Usage: pi5-image-deploy.sh <prepare|status> [options]

prepare builds and validates immutable candidate images without replacing production.

prepare options:
  --ref FULL_SHA       exact checked-out source commit
  --run-id RUN_ID      owning rolling-release run
  --resource-evidence FILE
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Fail-closed while Phase 3 Blue/Green owns the gateway path.
if [[ "${PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD:-0}" != 1 ]]; then
  bash "${SCRIPT_DIR}/pi5-phase3-legacy-guard.sh"
fi

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || { usage; exit 2; }
shift || true
while (($#)); do
  case "$1" in
    --ref) REF="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --resource-evidence) RESOURCE_EVIDENCE_FILE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [[ "$DRY_RUN" != 1 || "${ROLLING_RELEASE_PROTOCOL:-}" == 2 ]]; then
  for test_name in PI5_CANDIDATE_TEST_LOAD_AVG PI5_DEPLOY_TEST_ALLOW_DIRTY_WORKTREE; do
    [[ -z "${!test_name:-}" ]] || die "test-only environment is forbidden in production: ${test_name}"
  done
fi

validate_protocol_policy() {
  [[ "${ROLLING_RELEASE_PROTOCOL:-}" == 2 ]] || return 0
  local control_name
  [[ "$DRY_RUN" == 0 ]] || die 'rolling-release candidate build cannot run in dry-run mode'
  [[ "$MIN_FREE_MEMORY_MB" == 768 ]] || die 'rolling-release candidate memory threshold is fixed at 768MB'
  [[ "$MIN_FREE_DISK_GB" == 10 ]] || die 'rolling-release candidate disk threshold is fixed at 10GB'
  [[ -z "$MAX_LOAD_AVG" ]] || die 'rolling-release candidate load threshold is derived from online CPUs'
  [[ "$LOAD_SAMPLE_COUNT" == 3 ]] || die 'rolling-release candidate load sample count is fixed at 3'
  [[ "$LOAD_SAMPLE_INTERVAL_SECONDS" == 20 ]] || die 'rolling-release candidate load sample interval is fixed at 20 seconds'
  [[ "$LOAD_WAIT_SECONDS" == 180 ]] || die 'rolling-release candidate load wait timeout is fixed at 180 seconds'
  [[ "$EVIDENCE_TTL_SECONDS" == 300 ]] || die 'rolling-release candidate evidence TTL is fixed at 300 seconds'
  for control_name in DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_DEFAULT_PLATFORM \
    BUILDKIT_HOST BUILDX_CONFIG COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES \
    COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR; do
    [[ -z "${!control_name:-}" ]] \
      || die "Docker/Compose control environment is forbidden under rolling-release: ${control_name}"
  done
}

validate_protocol_policy

compose() {
  local api_image="$1" web_image="$2"
  shift 2
  local compose_files=(-f "$BASE_COMPOSE" -f "$PHASE2_COMPOSE")
  [[ -z "$BUILD_OVERRIDE" ]] || compose_files+=(-f "$BUILD_OVERRIDE")
  VITE_RELEASE_SHA="${REF:-}" PI5_API_IMAGE="$api_image" PI5_WEB_IMAGE="$web_image" \
    docker compose --env-file "$ENV_FILE" "${compose_files[@]}" "$@"
}

safe_git() {
  env -i \
    HOME=/nonexistent \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C LC_ALL=C \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    git -c core.fsmonitor=false -c core.ignorestat=false -c core.trustctime=true \
      -c extensions.worktreeConfig=false -C "$PROJECT_DIR" "$@"
}

atomic_state() {
  local event="$1" api_image="$2" web_image="$3" previous_api="${4:-}" previous_web="${5:-}" result="${6:-}"
  local build_mode="${7:-}" api_id="${8:-}" web_id="${9:-}" evidence="${10:-}"
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$event" "$api_image" "$web_image" "$previous_api" "$previous_web" "$result" \
    "$RUN_ID" "$REF" "$build_mode" "$api_id" "$web_id" "$evidence" "$SIGNAGE_CONTROL_EVENTS" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path,event,api,web,prev_api,prev_web,result,run_id,ref,build_mode,api_id,web_id,evidence,signage_events=sys.argv[1:]
try:
    with open(path, encoding="utf-8") as f: state = json.load(f)
except (FileNotFoundError, json.JSONDecodeError): state = {"version": 1}
candidate = {"api": api, "web": web}
if api_id and web_id:
    candidate["imageIds"]={"api":api_id,"web":web_id}
previous = {"api": prev_api, "web": prev_web}
state.update({"event": event, "updatedAt": datetime.now(timezone.utc).isoformat(), "candidate": candidate,
              "runId":run_id or None,"desiredSha":ref or None})
if event in {"building", "prepared", "failed"}:
    # A prepared image has not changed production. Do not let an operator mistake
    # an older rollback pair for a rollback target for this new candidate.
    state["rollbackEligible"] = False
elif event == "switching":
    state["active"] = previous
    state["previous"] = previous
    state["rollbackEligible"] = False
elif event == "active":
    state["active"] = candidate
    state["previous"] = previous
    state["rollbackEligible"] = True
elif event == "rolled-back":
    state["active"] = previous
    state["previous"] = candidate
    state["rollbackEligible"] = False
if result: state["result"] = result
if build_mode: state["build"]={"mode":build_mode}
if evidence: state["resourceEvidence"]={"path":evidence}
state["workloadControl"]={"signage":{"events":json.loads(signage_events)}}
fd, tmp = tempfile.mkstemp(prefix=".pi5-deploy-", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(state, f, separators=(",", ":")); f.write("\n"); f.flush(); os.fsync(f.fileno())
os.replace(tmp, path)
os.chmod(path, 0o600)
PY
}

read_state_value() {
  python3 - "$STATE_FILE" "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: value=json.load(f)
for key in sys.argv[2].split('.'):
    value=value[key]
print(value)
PY
}

require_sha() {
  [[ "$REF" =~ ^[0-9a-f]{40}$ ]] || die "--ref must be a full 40-character Git commit SHA"
  python3 - "$PROJECT_DIR" <<'PY' || die 'project repository path contains a symbolic link or is not a directory'
import os, pathlib, stat, sys
path=pathlib.Path(sys.argv[1])
current=pathlib.Path(path.anchor)
for part in path.parts[1:]:
    current /= part
    metadata=current.lstat()
    if stat.S_ISLNK(metadata.st_mode): raise SystemExit(1)
if not path.is_dir() or os.path.realpath(path) != str(path.absolute()): raise SystemExit(1)
PY
  [[ "$(safe_git rev-parse --show-toplevel)" == "$PROJECT_DIR" ]] \
    || die 'project path is not the exact Git worktree root'
  safe_git cat-file -e "${REF}^{commit}" 2>/dev/null || die "commit is not available locally: $REF"
  [[ "$(safe_git rev-parse --verify HEAD)" == "$REF" ]] || die "checked-out source does not match --ref: $REF"
  if [[ "$DRY_RUN" != "1" || "${PI5_DEPLOY_TEST_ALLOW_DIRTY_WORKTREE:-0}" != "1" ]]; then
    safe_git ls-files --unmerged -z | python3 -c 'import sys; raise SystemExit(1 if sys.stdin.buffer.read() else 0)' \
      || die 'repository index contains unmerged entries'
    safe_git ls-files -v -z | python3 -c \
      'import sys; rows=[x for x in sys.stdin.buffer.read().split(b"\0") if x]; raise SystemExit(1 if any(x[:2] != b"H " for x in rows) else 0)' \
      || die 'repository index contains assume-unchanged, skip-worktree, fsmonitor, or non-ordinary entries'
    safe_git status --porcelain=v1 -z --untracked-files=all | \
      python3 -c 'import sys; raise SystemExit(1 if sys.stdin.buffer.read() else 0)' \
      || die 'repository has tracked or untracked changes; refusing a non-immutable candidate'
  fi
}

prepare_build_context() {
  [[ "$DRY_RUN" != 1 ]] || return 0
  BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/pi5-candidate-context.XXXXXX")"
  BUILD_OVERRIDE="$(mktemp "${TMPDIR:-/tmp}/pi5-candidate-compose.XXXXXX")"
  chmod 700 "$BUILD_CONTEXT"
  chmod 600 "$BUILD_OVERRIDE"
  safe_git archive --format=tar "$REF" | tar -xf - -C "$BUILD_CONTEXT"
  python3 - "$BUILD_OVERRIDE" "$BUILD_CONTEXT" <<'PY'
import json, pathlib, sys
path, context = pathlib.Path(sys.argv[1]), sys.argv[2]
path.write_text(
    'services:\n'
    '  api:\n'
    f'    build:\n      context: {json.dumps(context)}\n'
    '  web:\n'
    f'    build:\n      context: {json.dumps(context)}\n',
    encoding='utf-8',
)
PY
}

require_run() {
  [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] || die "--run-id is required and must be well formed"
  if [[ -z "$RESOURCE_EVIDENCE_FILE" ]]; then
    RESOURCE_EVIDENCE_FILE="${PROJECT_DIR}/logs/deploy/runs/${RUN_ID}/pi5-resource-evidence.json"
  fi
}

effective_build_args() {
  [[ -f "$BASE_COMPOSE" ]] || die "Base Compose file is missing: $BASE_COMPOSE"
  [[ -f "$PHASE2_COMPOSE" ]] || die "Phase 2 Compose file is missing: $PHASE2_COMPOSE"
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  VITE_RELEASE_SHA="$REF" PI5_API_IMAGE=unused-api PI5_WEB_IMAGE=unused-web \
    docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$PHASE2_COMPOSE" \
      config --format json |
    python3 -c '
import json, sys

def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError(f"duplicate Compose JSON key: {key}")
        result[key] = value
    return result

document = json.load(sys.stdin, object_pairs_hook=pairs)
services = document.get("services") if isinstance(document, dict) else None
allowed = {
    "api": {"INSTALL_PLAYWRIGHT_CHROMIUM"},
    "web": {
        "VITE_AGENT_WS_URL",
        "VITE_API_BASE_URL",
        "VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED",
        "VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED",
        "VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED",
        "VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED",
        "VITE_RELEASE_SHA",
    },
}
sanitized = {}
if not isinstance(services, dict):
    raise SystemExit("effective Compose services are missing")
for service, expected_keys in allowed.items():
    record = services.get(service)
    build = record.get("build") if isinstance(record, dict) else None
    arguments = build.get("args") if isinstance(build, dict) else None
    if not isinstance(arguments, dict) or set(arguments) != expected_keys:
        raise SystemExit(f"effective {service} build arguments differ from the sealed allow-list")
    if any(not isinstance(value, str) or "\0" in value for value in arguments.values()):
        raise SystemExit(f"effective {service} build arguments contain a malformed value")
    sanitized[service] = {key: arguments[key] for key in sorted(arguments)}
json.dump(sanitized, sys.stdout, sort_keys=True, separators=(",", ":"), allow_nan=False)
'
}

candidate_config_hash() {
  effective_build_args | python3 -c '
import hashlib, sys
digest = hashlib.sha256()
for block in iter(lambda: sys.stdin.buffer.read(1024 * 1024), b""):
    digest.update(block)
print(digest.hexdigest())
'
}

seal_effective_build_args() {
  BUILD_ARGS_FILE="$(mktemp "${TMPDIR:-/tmp}/pi5-candidate-build-args.XXXXXX")"
  chmod 600 "$BUILD_ARGS_FILE"
  effective_build_args >"$BUILD_ARGS_FILE" \
    || die 'could not resolve the sanitized effective build arguments'
  SEALED_CONFIG_HASH="$(python3 - "$BUILD_ARGS_FILE" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
  [[ "$SEALED_CONFIG_HASH" =~ ^[0-9a-f]{64}$ ]] \
    || die 'sealed build-argument digest is malformed'
}

assert_effective_build_args_unchanged() {
  local expected_hash="$1" stage="$2" observed_hash
  observed_hash="$(candidate_config_hash)" \
    || die "could not re-evaluate effective build arguments at ${stage}"
  [[ "$observed_hash" == "$expected_hash" ]] \
    || die "effective build arguments changed after sealing (${stage})"
}

load_sealed_build_args() {
  local service="$1" destination="$2"
  [[ -f "$BUILD_ARGS_FILE" && ! -L "$BUILD_ARGS_FILE" ]] \
    || die 'sealed build arguments are unavailable'
  local -n output="$destination"
  BUILD_ARGS_RENDER_FILE="$(mktemp "${TMPDIR:-/tmp}/pi5-candidate-build-args-rendered.XXXXXX")" \
    || die 'could not allocate sealed build-argument rendering'
  chmod 600 "$BUILD_ARGS_RENDER_FILE"
  if ! python3 - "$BUILD_ARGS_FILE" "$service" >"$BUILD_ARGS_RENDER_FILE" <<'PY'
import json, sys
path, service = sys.argv[1:]
with open(path, encoding='utf-8') as stream:
    document = json.load(stream)
arguments = document.get(service) if isinstance(document, dict) else None
expected = {
    'api': {'INSTALL_PLAYWRIGHT_CHROMIUM'},
    'web': {
        'VITE_AGENT_WS_URL',
        'VITE_API_BASE_URL',
        'VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED',
        'VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED',
        'VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED',
        'VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED',
        'VITE_RELEASE_SHA',
    },
}
if set(document) != set(expected) or service not in expected:
    raise SystemExit('sealed build-argument document is malformed')
if not isinstance(arguments, dict) or set(arguments) != expected[service]:
    raise SystemExit('sealed service build arguments are malformed')
for key in sorted(arguments):
    value = arguments[key]
    if not isinstance(key, str) or not isinstance(value, str) or '\0' in key or '\0' in value:
        raise SystemExit('sealed build argument is malformed')
    sys.stdout.buffer.write(b'--build-arg\0' + f'{key}={value}'.encode() + b'\0')
PY
  then
    rm -f "$BUILD_ARGS_RENDER_FILE"
    BUILD_ARGS_RENDER_FILE=""
    die "could not decode sealed ${service} build arguments"
  fi
  output=()
  if ! mapfile -d '' -t output <"$BUILD_ARGS_RENDER_FILE"; then
    rm -f "$BUILD_ARGS_RENDER_FILE"
    BUILD_ARGS_RENDER_FILE=""
    die "could not load sealed ${service} build arguments"
  fi
  rm -f "$BUILD_ARGS_RENDER_FILE"
  BUILD_ARGS_RENDER_FILE=""
  ((${#output[@]} > 0)) || die "sealed ${service} build arguments are empty"
}

candidate_tag() {
  local config_hash="$1" run_digest
  [[ "$config_hash" =~ ^[0-9a-f]{64}$ ]] || die 'effective candidate build-argument digest is malformed'
  [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] \
    || die 'candidate image tag requires a well-formed run ID'
  # Keep every durable slot tag owned by exactly one coordinator run. A full
  # digest avoids Docker's 128-byte tag limit without weakening run identity.
  run_digest="$(python3 - "$RUN_ID" <<'PY'
import hashlib, sys
print(hashlib.sha256(sys.argv[1].encode('utf-8')).hexdigest())
PY
)"
  [[ "$run_digest" =~ ^[0-9a-f]{64}$ ]] || die 'candidate run digest is malformed'
  printf '%s-%s-%s\n' "$REF" "${config_hash:0:12}" "$run_digest"
}

resource_guard() {
  local memory_mb disk_kb disk_gb
  if [[ "$DRY_RUN" == "1" ]]; then
    LAST_MEMORY_MB="$MIN_FREE_MEMORY_MB"
    LAST_DISK_GB="$MIN_FREE_DISK_GB"
    return 0
  fi
  if [[ -r /proc/meminfo ]]; then
    memory_mb="$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
  else
    memory_mb="$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))"
  fi
  disk_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')"
  disk_gb=$((disk_kb / 1024 / 1024))
  ((memory_mb >= MIN_FREE_MEMORY_MB)) || die "available memory ${memory_mb}MB is below ${MIN_FREE_MEMORY_MB}MB"
  ((disk_gb >= MIN_FREE_DISK_GB)) || die "free disk ${disk_gb}GB is below ${MIN_FREE_DISK_GB}GB"
  LAST_MEMORY_MB="$memory_mb"
  LAST_DISK_GB="$disk_gb"
}

load_value() {
  if [[ "$DRY_RUN" == 1 && -n "${PI5_CANDIDATE_TEST_LOAD_AVG:-}" ]]; then
    printf '%s\n' "$PI5_CANDIDATE_TEST_LOAD_AVG"
  else
    awk '{print $1; exit}' /proc/loadavg
  fi
}

maximum_load() {
  if [[ -n "$MAX_LOAD_AVG" ]]; then printf '%s\n' "$MAX_LOAD_AVG"; return; fi
  local cpu_count
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || true)"
  [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]] || die 'online CPU count could not be read'
  awk "BEGIN {printf \"%.2f\", $cpu_count * 0.75}"
}

wait_for_stable_load() {
  local stage="$1" maximum load consecutive=0 deadline now samples='[]'
  maximum="$(maximum_load)"
  [[ "$maximum" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'maximum load average is invalid'
  if [[ "$DRY_RUN" == 1 ]]; then
    now="$(date +%s)"
    LAST_LOAD_SAMPLES="[{\"atEpoch\":$((now - 40)),\"load\":0.0},{\"atEpoch\":$((now - 20)),\"load\":0.0},{\"atEpoch\":${now},\"load\":0.0}]"
    log "DRY-RUN: stable load check (${stage})"
    return 0
  fi
  [[ "$LOAD_SAMPLE_COUNT" =~ ^[1-9][0-9]*$ ]] || die 'load sample count is invalid'
  [[ "$LOAD_SAMPLE_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'load sample interval is invalid'
  [[ "$LOAD_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'load wait timeout is invalid'
  deadline=$(( $(date +%s) + LOAD_WAIT_SECONDS ))
  while true; do
    load="$(load_value)"
    [[ "$load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'load average could not be read'
    now="$(date +%s)"
    samples="$(python3 - "$samples" "$now" "$load" <<'PY'
import json,sys
items=json.loads(sys.argv[1]); items.append({'atEpoch':int(sys.argv[2]),'load':float(sys.argv[3])})
print(json.dumps(items,separators=(',',':')))
PY
)"
    if awk "BEGIN {exit !($load < $maximum)}"; then
      consecutive=$((consecutive + 1))
      log "load sample ${consecutive}/${LOAD_SAMPLE_COUNT} passed at ${stage}: ${load}/${maximum}"
      if ((consecutive >= LOAD_SAMPLE_COUNT)); then LAST_LOAD_SAMPLES="$samples"; return 0; fi
    else
      consecutive=0
      log "load sample reset at ${stage}: ${load}/${maximum}"
    fi
    ((now < deadline)) || die "load did not remain below ${maximum} for ${LOAD_SAMPLE_COUNT} samples (${stage})"
    sleep "$LOAD_SAMPLE_INTERVAL_SECONDS"
  done
}

image_id() { docker image inspect -f '{{.Id}}' "$1"; }

image_provenance_is_exact() {
  local image="$1" config_hash="$2" revision observed_hash
  revision="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null || true)"
  observed_hash="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.config-hash" }}' "$image" 2>/dev/null || true)"
  [[ "$revision" == "$REF" && "$observed_hash" == "$config_hash" ]]
}

prepared_images_are_exact() {
  local api="$1" web="$2" config_hash="$3" api_id web_id maximum
  [[ -f "$STATE_FILE" ]] || return 1
  [[ -f "$RESOURCE_EVIDENCE_FILE" ]] || return 1
  api_id="$(image_id "$api" 2>/dev/null || true)"; web_id="$(image_id "$web" 2>/dev/null || true)"
  [[ -n "$api_id" && -n "$web_id" ]] || return 1
  image_provenance_is_exact "$api" "$config_hash" || return 1
  image_provenance_is_exact "$web" "$config_hash" || return 1
  python3 - "$STATE_FILE" "$RUN_ID" "$REF" "$api" "$web" "$api_id" "$web_id" <<'PY' || return 1
import json,sys
try: state=json.load(open(sys.argv[1],encoding='utf-8'))
except Exception: raise SystemExit(1)
candidate=state.get('candidate') or {}; ids=candidate.get('imageIds') or {}
expected=sys.argv[2:]
actual=[state.get('runId'),state.get('desiredSha'),candidate.get('api'),candidate.get('web'),ids.get('api'),ids.get('web')]
raise SystemExit(0 if actual==expected else 1)
PY
  maximum="$(maximum_load)"
  python3 "${SCRIPT_DIR}/pi5-release-evidence.py" verify-resource \
    --path "$RESOURCE_EVIDENCE_FILE" --run-id "$RUN_ID" --sha "$REF" \
    --api-image "$api" --web-image "$web" --api-image-id "$api_id" --web-image-id "$web_id" \
    --min-memory-mb "$MIN_FREE_MEMORY_MB" --min-disk-gb "$MIN_FREE_DISK_GB" \
    --max-load "$maximum" >/dev/null 2>&1
}

active_api_container() {
  local state="$BLUE_GREEN_STATE_FILE" slot candidate
  if [[ -f "$state" ]]; then
    if ! slot="$(python3 - "$state" <<'PY' 2>/dev/null
import json,sys
try:
    value=json.load(open(sys.argv[1],encoding='utf-8')).get('activeSlot')
except Exception:
    raise SystemExit(1)
if value not in {'blue','green'}: raise SystemExit(1)
print(value)
PY
)"; then
      return 1
    fi
    candidate="$(docker ps -q \
      --filter "label=com.docker.compose.project=${PI5_BLUE_GREEN_COMPOSE_PROJECT:-bluegreen}" \
      --filter "label=com.docker.compose.service=api-${slot}" | head -1)"
    [[ -n "$candidate" ]] || return 1
    printf '%s\n' "$candidate"
    return 0
  fi
  docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" ps -q api 2>/dev/null | head -1
}

write_signage_pause_owner() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  mkdir -p "$(dirname "$SIGNAGE_PAUSE_OWNER_FILE")"
  python3 - "$SIGNAGE_PAUSE_OWNER_FILE" "$RUN_ID" "$REF" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone

path, run_id, release_sha = sys.argv[1:]
state = {
    "version": 1,
    "state": "resume-required",
    "ownerRunId": run_id,
    "releaseSha": release_sha,
    "createdAt": datetime.now(timezone.utc).isoformat(),
}
fd, temporary = tempfile.mkstemp(prefix=".signage-pause-owner-", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    json.dump(state, stream, separators=(",", ":"))
    stream.write("\n")
    stream.flush()
    os.fsync(stream.fileno())
os.replace(temporary, path)
os.chmod(path, 0o600)
directory = os.open(os.path.dirname(path), os.O_RDONLY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

validate_signage_pause_owner() {
  python3 - "$SIGNAGE_PAUSE_OWNER_FILE" <<'PY'
import json, re, sys
try:
    with open(sys.argv[1], encoding="utf-8") as stream:
        value = json.load(stream)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)
if not isinstance(value, dict) or set(value) != {
    "version", "state", "ownerRunId", "releaseSha", "createdAt"
}:
    raise SystemExit(1)
if value["version"] != 1 or value["state"] != "resume-required":
    raise SystemExit(1)
if not isinstance(value["ownerRunId"], str) or re.fullmatch(
    r"[A-Za-z0-9][A-Za-z0-9_-]{2,79}", value["ownerRunId"]
) is None:
    raise SystemExit(1)
if not isinstance(value["releaseSha"], str) or re.fullmatch(
    r"[0-9a-f]{40}", value["releaseSha"]
) is None:
    raise SystemExit(1)
if not isinstance(value["createdAt"], str) or not value["createdAt"]:
    raise SystemExit(1)
PY
}

clear_signage_pause_owner() {
  [[ "$DRY_RUN" == 1 || ! -e "$SIGNAGE_PAUSE_OWNER_FILE" ]] && return 0
  python3 - "$SIGNAGE_PAUSE_OWNER_FILE" <<'PY'
import os, sys
path = sys.argv[1]
try:
    os.unlink(path)
except FileNotFoundError:
    raise SystemExit(0)
directory = os.open(os.path.dirname(path), os.O_RDONLY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

reconcile_signage_pause_owner() {
  [[ -e "$SIGNAGE_PAUSE_OWNER_FILE" ]] || return 0
  validate_signage_pause_owner \
    || die 'durable signage pause owner is malformed; refusing candidate work'
  SIGNAGE_PAUSED=1
  SIGNAGE_RESUME_REQUIRED=1
  SIGNAGE_CONTAINER_ID=""
  record_signage_event takeover resume-required
  resume_signage \
    || die 'could not reconcile signage paused by an interrupted candidate build'
  log 'reconciled durable signage pause owner before candidate work'
}

record_signage_event() {
  local action="$1" state="$2" detail="${3:-}"
  SIGNAGE_CONTROL_EVENTS="$(python3 - "$SIGNAGE_CONTROL_EVENTS" "$action" "$state" "$detail" <<'PY'
import json,sys,time
events=json.loads(sys.argv[1]); events.append({'atEpoch':int(time.time()),'action':sys.argv[2],'state':sys.argv[3],'detail':sys.argv[4]})
print(json.dumps(events,separators=(',',':')))
PY
)"
}

set_signage_state() {
  local action="$1" output revision resume_required
  if [[ "$DRY_RUN" == 1 ]]; then
    record_signage_event "$action" dry-run
    log "DRY-RUN: ${action} signage renderer"
    return 0
  fi
  [[ -n "$SIGNAGE_CONTAINER_ID" ]] || SIGNAGE_CONTAINER_ID="$(active_api_container)"
  [[ -n "$SIGNAGE_CONTAINER_ID" ]] || { record_signage_event "$action" failed 'active API unavailable'; return 1; }
  if output="$(docker exec "$SIGNAGE_CONTAINER_ID" node - "$action" <<'JS' 2>&1
const action=process.argv[2];
const token=process.env.DEPLOY_CONTROL_TOKEN || process.env.JWT_ACCESS_SECRET;
if(!token){console.error('deploy control token is missing in the active API container');process.exit(1)}
(async()=>{
  try {
    const response=await fetch('http://127.0.0.1:8080/api/system/deploy-workload/internal', {
      method:'POST', headers:{'content-type':'application/json','x-deploy-control-token':token},
      body:JSON.stringify({action})
    });
    const text=await response.text();
    if(!response.ok){
      process.stderr.write(`DEPLOY_WORKLOAD_HTTP_STATUS=${response.status}\n${text}`);
      process.exitCode=1;
      return;
    }
    process.stdout.write(text);
  } catch(error) {
    const detail=error instanceof Error ? error.message : String(error);
    process.stderr.write(`DEPLOY_WORKLOAD_TRANSPORT_ERROR=${detail}`);
    process.exitCode=1;
  }
})();
JS
)"; then
    if ! resume_required="$(python3 - "$output" "$action" <<'PY'
import json, sys
try:
    document=json.loads(sys.argv[1])
except (json.JSONDecodeError, TypeError):
    raise SystemExit(1)
action=sys.argv[2]
if not isinstance(document, dict) or document.get('action') != action:
    raise SystemExit(1)
signage=document.get('signage')
if not isinstance(signage, dict):
    raise SystemExit(1)
enabled=document.get('enabled')
resume_required=document.get('resumeRequired')
if isinstance(enabled, bool) and isinstance(resume_required, bool):
    if action == 'pause-signage' and resume_required != enabled:
        raise SystemExit(1)
    if action == 'resume-signage' and resume_required:
        raise SystemExit(1)
elif set(document) == {'action', 'signage'}:
    # The immediately preceding API contract returned only action + telemetry.
    # Accept it only when the observed scheduler state proves the requested
    # transition. A legacy pause is conservatively owned until a matching
    # legacy resume positively proves that rendering is active again.
    is_running=signage.get('isRunning')
    if not isinstance(is_running, bool):
        raise SystemExit(1)
    if action == 'pause-signage':
        if is_running:
            raise SystemExit(1)
        resume_required=True
    else:
        if not is_running:
            raise SystemExit(1)
        resume_required=False
else:
    raise SystemExit(1)
print('1' if resume_required else '0')
PY
)"; then
      record_signage_event "$action" failed 'malformed successful workload-control response'
      printf '%s\n' 'malformed successful workload-control response' >&2
      return 1
    fi
    SIGNAGE_RESUME_REQUIRED="$resume_required"
    record_signage_event "$action" completed "$output"
    return 0
  fi
  if [[ "$action" == pause-signage || "$action" == resume-signage ]] \
    && { [[ "$output" == 'DEPLOY_WORKLOAD_HTTP_STATUS=404' ]] \
      || [[ "$output" == 'DEPLOY_WORKLOAD_HTTP_STATUS=404'$'\n'* ]]; }; then
    revision="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$SIGNAGE_CONTAINER_ID" 2>/dev/null || true)"
    if [[ -z "$revision" ]]; then
      SIGNAGE_RESUME_REQUIRED=0
      record_signage_event "$action" legacy-api-unavailable "$output"
      log "signage ${action} is a verified no-op on the unlabeled legacy API"
      return 0
    fi
  fi
  record_signage_event "$action" failed "$output"
  printf '%s\n' "$output" >&2
  return 1
}

pause_signage() {
  # Once the request is sent, a lost response is indistinguishable from a
  # completed pause. Persist resume ownership before the request so SIGKILL or
  # power loss can be healed by the next coordinator takeover.
  write_signage_pause_owner \
    || die 'could not persist signage pause ownership before workload control'
  SIGNAGE_PAUSED=1
  SIGNAGE_RESUME_REQUIRED=""
  if ! set_signage_state pause-signage; then
    # A lost pause response may still have paused the worker. Reuse the normal
    # idempotent resume path so ownership is only cleared after a positive ACK.
    resume_signage || true
    die 'could not pause signage renderer'
  fi
  if [[ "$SIGNAGE_RESUME_REQUIRED" == 0 ]] \
    || [[ "$SIGNAGE_CONTROL_EVENTS" == *'"state":"legacy-api-unavailable"'* ]]; then
    SIGNAGE_PAUSED=0
    clear_signage_pause_owner \
      || die 'could not clear no-op signage pause ownership'
  fi
}

resume_signage() {
  ((SIGNAGE_PAUSED == 1)) || return 0
  local attempt
  for attempt in 1 2 3; do
    if set_signage_state resume-signage; then
      SIGNAGE_PAUSED=0
      clear_signage_pause_owner || return 1
      return 0
    fi
    ((attempt == 3)) || sleep 1
  done
  log 'ERROR: could not resume signage renderer after 3 attempts'
  return 1
}

candidate_container_absent() {
  local container="$1"
  if docker container inspect "$container" >/dev/null 2>&1; then
    return 1
  fi
  docker info >/dev/null 2>&1
}

remove_candidate_validation_container() {
  [[ -n "$CANDIDATE_CONTAINER_ID" ]] || return 0
  local attempt
  for attempt in 1 2 3; do
    docker rm -f "$CANDIDATE_CONTAINER_ID" >/dev/null 2>&1 || true
    if candidate_container_absent "$CANDIDATE_CONTAINER_ID"; then
      CANDIDATE_CONTAINER_ID=""
      return 0
    fi
    ((attempt == 3)) || sleep 1
  done
  log "ERROR: candidate validation container could not be removed: ${CANDIDATE_CONTAINER_ID}"
  return 1
}

candidate_validation_metadata() {
  docker container inspect -f \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.raspi-system.deploy-purpose"}}|{{index .Config.Labels "io.raspi-system.run-id"}}|{{index .Config.Labels "io.raspi-system.release-sha"}}' \
    "$1"
}

discover_current_candidate_validation_container() {
  local metadata id name purpose owner sha
  if ! metadata="$(candidate_validation_metadata "$CANDIDATE_CONTAINER_NAME" 2>/dev/null)"; then
    docker info >/dev/null 2>&1 || return 1
    CANDIDATE_CONTAINER_ID=""
    return 0
  fi
  IFS='|' read -r id name purpose owner sha <<<"$metadata"
  [[ "$id" =~ ^[0-9a-fA-F]{12,64}$ \
    && "$name" == "/${CANDIDATE_CONTAINER_NAME}" \
    && "$purpose" == candidate-validation \
    && "$owner" == "$RUN_ID" \
    && "$sha" == "$REF" ]] || return 1
  CANDIDATE_CONTAINER_ID="$id"
}

cleanup_orphan_candidate_validation_containers() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local ids id metadata observed_id name purpose owner sha
  ids="$(docker ps -aq \
    --filter 'label=io.raspi-system.deploy-purpose=candidate-validation' \
    2>/dev/null)" || return 1
  for id in $ids; do
    metadata="$(candidate_validation_metadata "$id" 2>/dev/null)" \
      || { docker info >/dev/null 2>&1 || return 1; continue; }
    IFS='|' read -r observed_id name purpose owner sha <<<"$metadata"
    [[ "$observed_id" == "$id" \
      && "$observed_id" =~ ^[0-9a-fA-F]{12,64}$ \
      && "$name" == /pi5-api-candidate-* \
      && "$purpose" == candidate-validation \
      && "$owner" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ \
      && "$sha" =~ ^[0-9a-f]{40}$ ]] || return 1
    CANDIDATE_CONTAINER_ID="$id"
    remove_candidate_validation_container || return 1
  done
}

candidate_image_tag_absent() {
  local image="$1"
  if docker image inspect "$image" >/dev/null 2>&1; then return 1; fi
  docker info >/dev/null 2>&1
}

cleanup_owned_candidate_image_tags() {
  [[ "$DRY_RUN" == 1 || ! -f "$STATE_FILE" ]] && return 0
  local metadata owner sha api web api_id web_id run_digest expected_tag
  local api_repository api_tag web_repository web_tag
  metadata="$(python3 - "$STATE_FILE" <<'PY'
import json, re, shlex, sys
try:
    with open(sys.argv[1], encoding='utf-8') as stream:
        state=json.load(stream)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)
candidate=state.get('candidate')
ids=candidate.get('imageIds') if isinstance(candidate, dict) else None
owner=state.get('runId')
sha=state.get('desiredSha')
if owner is None: owner=''
if sha is None: sha=''
values=(owner, sha,
        candidate.get('api') if isinstance(candidate, dict) else None,
        candidate.get('web') if isinstance(candidate, dict) else None,
        ids.get('api') if isinstance(ids, dict) else '',
        ids.get('web') if isinstance(ids, dict) else '')
if any(value is None or not isinstance(value, str) or '\n' in value for value in values):
    raise SystemExit(1)
for name, value in zip(('owner','sha','api','web','api_id','web_id'), values):
    print(f'{name}={shlex.quote(value)}')
PY
)" || return 1
  eval "$metadata"
  if [[ -f "$BLUE_GREEN_STATE_FILE" ]]; then
    local phase3_ownership
    phase3_ownership="$(python3 - "$BLUE_GREEN_STATE_FILE" "$api" "$web" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as stream:
        state=json.load(stream)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)
slots=state.get('slots')
if not isinstance(slots, dict): raise SystemExit(1)
referenced=[]
for slot in ('blue','green'):
    record=slots.get(slot)
    images=record.get('images') if isinstance(record,dict) else None
    if not isinstance(images,dict): raise SystemExit(1)
    referenced.extend((images.get('api'),images.get('web')))
retired=state.get('retiredImages')
if retired is not None:
    images=retired.get('images') if isinstance(retired,dict) else None
    if not isinstance(images,dict): raise SystemExit(1)
    referenced.extend((images.get('api'),images.get('web')))
ownership=[item in referenced for item in sys.argv[2:]]
if all(ownership): print('phase3-owned')
elif not any(ownership): print('unreferenced')
else: raise SystemExit(1)
PY
)" || return 1
    case "$phase3_ownership" in
      phase3-owned) return 0 ;;
      unreferenced) ;;
      *) return 1 ;;
    esac
  fi

  # A deployed pre-run-scoped state has no runId, desiredSha, or imageIds.
  # It is safe to leave that state alone only when Blue/Green proves that the
  # complete candidate pair is still an active/rollback reference. Anything
  # unreferenced must satisfy the strict run-scoped ownership contract below.
  [[ "$owner" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ \
    && "$sha" =~ ^[0-9a-f]{40}$ \
    && ( -z "$api_id" || "$api_id" =~ ^sha256:[0-9a-f]{64}$ ) \
    && ( -z "$web_id" || "$web_id" =~ ^sha256:[0-9a-f]{64}$ ) \
    && ( ( -z "$api_id" && -z "$web_id" ) \
      || ( -n "$api_id" && -n "$web_id" ) ) ]] || return 1
  run_digest="$(python3 - "$owner" <<'PY'
import hashlib, sys
print(hashlib.sha256(sys.argv[1].encode()).hexdigest())
PY
)"
  expected_tag="${sha}-[0-9a-f]{12}-${run_digest}"
  api_repository="${api%:*}"; api_tag="${api##*:}"
  web_repository="${web%:*}"; web_tag="${web##*:}"
  [[ "$api_repository" == "$API_REPOSITORY" \
    && "$web_repository" == "$WEB_REPOSITORY" \
    && "$api_tag" =~ ^${expected_tag}$ \
    && "$web_tag" =~ ^${expected_tag}$ ]] || return 1
  [[ "$owner" != "$RUN_ID" || "$sha" != "$REF" ]] || return 0

  local containers container image expected_id observed_id revision config_hash tag_config
  containers="$(docker ps -aq 2>/dev/null)" || return 1
  for image in "$api" "$web"; do
    [[ "$image" == "$api" ]] && expected_id="$api_id" || expected_id="$web_id"
    if candidate_image_tag_absent "$image"; then continue; fi
    observed_id="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null)" || return 1
    revision="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null)" || return 1
    config_hash="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.config-hash" }}' "$image" 2>/dev/null)" || return 1
    tag_config="${image#*:${sha}-}"; tag_config="${tag_config%%-*}"
    [[ "$revision" == "$sha" && "$config_hash" == "$tag_config"* \
      && ( -z "$expected_id" || "$expected_id" == "$observed_id" ) ]] || return 1
    for container in $containers; do
      [[ "$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)" != "$observed_id" ]] \
        || return 1
    done
    docker image rm "$image" >/dev/null 2>&1 \
      || candidate_image_tag_absent "$image" || return 1
    candidate_image_tag_absent "$image" || return 1
  done
}

reconcile_candidate_build_residue() {
  reconcile_signage_pause_owner
  cleanup_orphan_candidate_validation_containers \
    || die 'could not reconcile orphaned candidate validation containers'
  cleanup_owned_candidate_image_tags \
    || die 'could not reconcile an owned run-scoped candidate image tag'
}

image_deploy_cleanup() {
  local rc=$? container_rc=0 resume_rc=0
  if [[ "$DRY_RUN" != 1 && -n "$CANDIDATE_CONTAINER_ID" ]]; then
    remove_candidate_validation_container || container_rc=$?
  fi
  resume_signage || resume_rc=$?
  if ((rc == 0 && container_rc != 0)); then rc="$container_rc"; fi
  if ((rc == 0 && resume_rc != 0)); then rc="$resume_rc"; fi
  if ((PREPARE_ACTIVE == 1)); then
    atomic_state failed "$PREPARE_API" "$PREPARE_WEB" "" "" "failure:${rc}" || true
  fi
  [[ -z "$BUILD_CONTEXT" ]] || rm -rf "$BUILD_CONTEXT"
  [[ -z "$BUILD_OVERRIDE" ]] || rm -f "$BUILD_OVERRIDE"
  [[ -z "$BUILD_ARGS_FILE" ]] || rm -f "$BUILD_ARGS_FILE"
  [[ -z "$BUILD_ARGS_RENDER_FILE" ]] || rm -f "$BUILD_ARGS_RENDER_FILE"
  ((LOCK_DIR_ACQUIRED == 0)) || rmdir "$LOCK_DIR" 2>/dev/null || true
  trap - EXIT
  exit "$rc"
}

prepare() {
  # This takeover runs before source validation, load planning, or the image
  # reuse/no-op branch. It heals a hard-killed prior build unconditionally.
  require_run
  reconcile_candidate_build_residue
  require_sha
  resource_guard
  local tag api web candidate_output candidate_reported_id build_mode api_id web_id maximum config_hash
  local -a api_build_args=() web_build_args=()
  seal_effective_build_args
  config_hash="$SEALED_CONFIG_HASH"
  tag="$(candidate_tag "$config_hash")"
  api="${API_REPOSITORY}:${tag}"; web="${WEB_REPOSITORY}:${tag}"
  CANDIDATE_CONTAINER_NAME="pi5-api-candidate-${RUN_ID}-${REF:0:12}"
  PREPARE_ACTIVE=1; PREPARE_API="$api"; PREPARE_WEB="$web"
  atomic_state building "$api" "$web" "" "" in-progress
  pause_signage
  wait_for_stable_load pre-build
  assert_effective_build_args_unchanged "$config_hash" pre-build
  if [[ "$DRY_RUN" != 1 ]] && prepared_images_are_exact "$api" "$web" "$config_hash"; then
    build_mode=reused
    log "reusing exact run-scoped candidate images for ${REF}"
  else
    build_mode=built
    rm -f "$RESOURCE_EVIDENCE_FILE"
    log "building candidate images serially from the sealed Git commit while production remains active"
    if [[ "$DRY_RUN" == 1 ]]; then
      printf 'DRY-RUN: VITE_RELEASE_SHA=%q PI5_API_IMAGE=%q docker compose build api then PI5_WEB_IMAGE=%q docker compose build web\n' "$REF" "$api" "$web"
    else
      prepare_build_context
      load_sealed_build_args api api_build_args
      load_sealed_build_args web web_build_args
      assert_effective_build_args_unchanged "$config_hash" api-build
      compose "$api" "$web" build "${api_build_args[@]}" \
        --build-arg "BUILD_COMMIT=${REF}" --build-arg "BUILD_CONFIG_HASH=${config_hash}" api
      assert_effective_build_args_unchanged "$config_hash" web-build
      compose "$api" "$web" build "${web_build_args[@]}" \
        --build-arg "BUILD_COMMIT=${REF}" --build-arg "BUILD_CONFIG_HASH=${config_hash}" web
    fi
  fi
  # Once the reuse decision is made, discard the prior proof. A failed retry
  # must never leave an earlier run's load evidence looking current.
  rm -f "$RESOURCE_EVIDENCE_FILE"
  run env VITE_RELEASE_SHA="$REF" PI5_API_IMAGE="$api" PI5_WEB_IMAGE="$web" docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$PHASE2_COMPOSE" config --quiet
  run docker run --rm \
    -v "$PROJECT_DIR/certs:/srv/certs:ro" \
    "$web" sh -ec 'envsubst < /srv/Caddyfile.local.template > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile'
  run docker run --rm \
    -v "$PROJECT_DIR/certs:/srv/certs:ro" \
    "$web" caddy validate --config /srv/Caddyfile.maintenance.local
  run docker run --rm "$web" caddy validate --config /srv/Caddyfile.maintenance.http
  run docker run --rm -e DOMAIN=maintenance.invalid -e CADDY_ADMIN_EMAIL=admin@maintenance.invalid \
    "$web" caddy validate --config /srv/Caddyfile.maintenance.production
  if [[ "$DRY_RUN" != "1" ]]; then
    candidate_output=""
    if ! candidate_output="$(compose "$api" "$web" run -d --no-deps \
      -e PI5_CANDIDATE_VALIDATION=1 -e SIGNAGE_RENDER_ENABLED=false \
      --label io.raspi-system.deploy-purpose=candidate-validation \
      --label "io.raspi-system.run-id=${RUN_ID}" \
      --label "io.raspi-system.release-sha=${REF}" \
      --name "$CANDIDATE_CONTAINER_NAME" api)"; then
      log 'candidate create response was lost or failed; resolving the deterministic container identity'
    fi
    discover_current_candidate_validation_container \
      || die 'candidate validation container ownership is malformed'
    [[ -n "$CANDIDATE_CONTAINER_ID" ]] \
      || die 'candidate validation container was not created'
    candidate_reported_id="${candidate_output##*$'\n'}"
    if [[ -n "$candidate_reported_id" \
      && "$candidate_reported_id" =~ ^[0-9a-fA-F]{12,64}$ \
      && "$CANDIDATE_CONTAINER_ID" != "$candidate_reported_id"* ]]; then
      die 'candidate create response does not match the deterministic container'
    fi
    for _ in $(seq 1 30); do
      if docker exec "$CANDIDATE_CONTAINER_ID" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
      sleep 2
    done
    if ! docker exec "$CANDIDATE_CONTAINER_ID" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      die "candidate API health check failed"
    fi
    remove_candidate_validation_container \
      || die 'candidate API passed health but its validation container could not be removed'
    api_id="$(image_id "$api")"; web_id="$(image_id "$web")"
    assert_effective_build_args_unchanged "$config_hash" provenance
    [[ "$api_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'candidate Docker image identity is malformed'
    image_provenance_is_exact "$api" "$config_hash" || die 'candidate API image provenance label does not match the sealed source/config'
    image_provenance_is_exact "$web" "$config_hash" || die 'candidate Web image provenance label does not match the sealed source/config'
  else
    api_id="sha256:$(printf '%064d' 1)"
    web_id="sha256:$(printf '%064d' 2)"
  fi
  wait_for_stable_load post-build
  resource_guard
  assert_effective_build_args_unchanged "$config_hash" evidence
  maximum="$(maximum_load)"
  mkdir -p "$(dirname "$RESOURCE_EVIDENCE_FILE")"
  python3 "${SCRIPT_DIR}/pi5-release-evidence.py" create-resource \
    --output "$RESOURCE_EVIDENCE_FILE" --run-id "$RUN_ID" --sha "$REF" \
    --api-image "$api" --web-image "$web" --api-image-id "$api_id" --web-image-id "$web_id" \
    --memory-mb "$LAST_MEMORY_MB" --disk-gb "$LAST_DISK_GB" \
    --min-memory-mb "$MIN_FREE_MEMORY_MB" --min-disk-gb "$MIN_FREE_DISK_GB" \
    --max-load "$maximum" --samples-json "$LAST_LOAD_SAMPLES" --ttl "$EVIDENCE_TTL_SECONDS"
  resume_signage || die 'candidate was built but signage renderer could not be resumed'
  atomic_state prepared "$api" "$web" "" "" success "$build_mode" "$api_id" "$web_id" "$RESOURCE_EVIDENCE_FILE"
  PREPARE_ACTIVE=0
  log "candidate prepared: ${REF}"
}

mkdir -p "$(dirname "$LOCK_FILE")"
trap image_deploy_cleanup EXIT
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "another Pi5 image deployment is running"
else
  LOCK_DIR="${LOCK_FILE}.d"
  mkdir "$LOCK_DIR" 2>/dev/null || die "another Pi5 image deployment is running"
  LOCK_DIR_ACQUIRED=1
fi
case "$COMMAND" in
  prepare) prepare ;;
  reconcile-workload) reconcile_candidate_build_residue ;;
  status) [[ -f "$STATE_FILE" ]] && python3 -m json.tool "$STATE_FILE" || echo '{"state":"not-initialized"}' ;;
  cleanup) die 'Phase 2 image cleanup is retired; use the Blue/Green coordinator cleanup' ;;
  *) usage; exit 2 ;;
esac
