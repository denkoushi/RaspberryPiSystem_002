#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
BASE_COMPOSE="${PI5_BASE_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
PHASE2_COMPOSE="${PI5_PHASE2_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase2.yml}"
ENV_FILE="${PI5_ENV_FILE:-${PROJECT_DIR}/infrastructure/docker/.env}"
STATE_FILE="${PI5_DEPLOY_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-image-deploy-state.json}"
LOCK_FILE="${PI5_DEPLOY_LOCK_FILE:-${PROJECT_DIR}/logs/.pi5-image-deploy.lock}"
API_REPOSITORY="${PI5_API_IMAGE_REPOSITORY:-raspi-system-api}"
WEB_REPOSITORY="${PI5_WEB_IMAGE_REPOSITORY:-raspi-system-web}"
HEALTH_URL="${PI5_HEALTH_URL:-https://127.0.0.1/api/system/health}"
WEB_URL="${PI5_WEB_URL:-https://127.0.0.1/}"
MAINTENANCE_URL="${PI5_MAINTENANCE_URL:-https://127.0.0.1/}"
MIN_FREE_MEMORY_MB="${PI5_MIN_FREE_MEMORY_MB:-768}"
MIN_FREE_DISK_GB="${PI5_MIN_FREE_DISK_GB:-10}"
MAX_LOAD_AVG="${PI5_CANDIDATE_MAX_LOAD_AVG:-${PI5_BLUE_GREEN_MAX_LOAD_AVG:-}}"
LOAD_SAMPLE_COUNT="${PI5_CANDIDATE_LOAD_SAMPLE_COUNT:-3}"
LOAD_SAMPLE_INTERVAL_SECONDS="${PI5_CANDIDATE_LOAD_SAMPLE_INTERVAL_SECONDS:-20}"
LOAD_WAIT_SECONDS="${PI5_CANDIDATE_LOAD_WAIT_SECONDS:-600}"
DRY_RUN="${PI5_DEPLOY_DRY_RUN:-0}"
FORCE_DESTRUCTIVE_MIGRATION=0
REF=""
LAST_LOAD_SAMPLES="[]"
SIGNAGE_CONTAINER_ID=""
SIGNAGE_PAUSED=0
LOCK_DIR=""

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
run() {
  if [[ "$DRY_RUN" == "1" ]]; then printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

usage() {
  cat <<'EOF'
Usage: pi5-image-deploy.sh <prepare|switch|rollback|status|cleanup> [--ref FULL_SHA]

prepare builds and validates immutable candidate images without replacing production.
switch uses an already prepared candidate and restores previous images on failure.
rollback restores the previous API and Web images recorded in the state file.
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
    --force-destructive-migration) FORCE_DESTRUCTIVE_MIGRATION=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

compose() {
  PI5_API_IMAGE="$1" PI5_WEB_IMAGE="$2" docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$PHASE2_COMPOSE" "${@:3}"
}

atomic_state() {
  local event="$1" api_image="$2" web_image="$3" previous_api="${4:-}" previous_web="${5:-}" result="${6:-}" build_mode="${7:-}"
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$event" "$api_image" "$web_image" "$previous_api" "$previous_web" "$result" "$build_mode" "$LAST_LOAD_SAMPLES" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, event, api, web, prev_api, prev_web, result, build_mode, load_samples = sys.argv[1:]
try:
 with open(path, encoding="utf-8") as f: state = json.load(f)
except (FileNotFoundError, json.JSONDecodeError): state = {"version": 1}
candidate = {"api": api, "web": web}
previous = {"api": prev_api, "web": prev_web}
state.update({"event": event, "updatedAt": datetime.now(timezone.utc).isoformat(), "candidate": candidate})
if event == "prepared":
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
if build_mode:
 state["build"] = {"mode": build_mode, "loadSamples": json.loads(load_samples)}
fd, tmp = tempfile.mkstemp(prefix=".pi5-deploy-", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(state, f, separators=(",", ":")); f.write("\n"); f.flush(); os.fsync(f.fileno())
os.replace(tmp, path)
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
  git -C "$PROJECT_DIR" cat-file -e "${REF}^{commit}" 2>/dev/null || die "commit is not available locally: $REF"
  [[ "$(git -C "$PROJECT_DIR" rev-parse HEAD)" == "$REF" ]] || die "checked-out source does not match --ref: $REF"
  if [[ "$DRY_RUN" != "1" || "${PI5_DEPLOY_TEST_ALLOW_DIRTY_WORKTREE:-0}" != "1" ]]; then
    git -C "$PROJECT_DIR" diff --quiet || die "repository has unstaged changes; refusing to tag a non-immutable candidate"
    git -C "$PROJECT_DIR" diff --cached --quiet || die "repository has staged changes; refusing to tag a non-immutable candidate"
    [[ -z "$(git -C "$PROJECT_DIR" ls-files --others --exclude-standard)" ]] || die "repository has untracked changes; refusing to tag a non-immutable candidate"
  fi
}

candidate_config_hash() {
  # The tag must represent the resolved deployment contract, not source SHA
  # alone. Include both Compose overlays and the protected environment file so
  # a changed service setting cannot accidentally reuse an old candidate.
  [[ -f "$BASE_COMPOSE" ]] || die "Base Compose file is missing: $BASE_COMPOSE"
  [[ -f "$PHASE2_COMPOSE" ]] || die "Phase 2 Compose file is missing: $PHASE2_COMPOSE"
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  python3 - "$BASE_COMPOSE" "$PHASE2_COMPOSE" "$ENV_FILE" <<'PY'
import hashlib, pathlib, sys
h=hashlib.sha256()
for raw in sys.argv[1:]:
    path=pathlib.Path(raw)
    h.update(str(path).encode('utf-8')); h.update(b'\0')
    h.update(path.read_bytes()); h.update(b'\0')
print(h.hexdigest())
PY
}

candidate_tag() {
  local config_hash
  config_hash="$(candidate_config_hash)"
  printf '%s-%s\n' "$REF" "${config_hash:0:12}"
}

resource_guard() {
  local memory_mb disk_kb disk_gb
  [[ "$DRY_RUN" == "1" ]] && return 0
  if [[ -r /proc/meminfo ]]; then
    memory_mb="$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
  else
    memory_mb="$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))"
  fi
  disk_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')"
  disk_gb=$((disk_kb / 1024 / 1024))
  ((memory_mb >= MIN_FREE_MEMORY_MB)) || die "available memory ${memory_mb}MB is below ${MIN_FREE_MEMORY_MB}MB"
  ((disk_gb >= MIN_FREE_DISK_GB)) || die "free disk ${disk_gb}GB is below ${MIN_FREE_DISK_GB}GB"
}

load_value() {
  if [[ -n "${PI5_CANDIDATE_TEST_LOAD_AVG:-}" ]]; then
    printf '%s\n' "$PI5_CANDIDATE_TEST_LOAD_AVG"
  else
    awk '{print $1; exit}' /proc/loadavg
  fi
}

maximum_load() {
  if [[ -n "$MAX_LOAD_AVG" ]]; then
    printf '%s\n' "$MAX_LOAD_AVG"
    return
  fi
  local cpu_count
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || true)"
  [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]] || die 'online CPU count could not be read'
  awk "BEGIN {printf \"%.2f\", $cpu_count * 0.75}"
}

wait_for_stable_load() {
  local stage="$1" maximum load consecutive=0 deadline now samples='[]'
  [[ "$DRY_RUN" == 1 ]] && { LAST_LOAD_SAMPLES='[]'; log "DRY-RUN: stable load check (${stage})"; return 0; }
  [[ "$LOAD_SAMPLE_COUNT" =~ ^[1-9][0-9]*$ ]] || die 'load sample count is invalid'
  [[ "$LOAD_SAMPLE_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'load sample interval is invalid'
  [[ "$LOAD_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die 'load wait timeout is invalid'
  maximum="$(maximum_load)"
  [[ "$maximum" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'maximum load average is invalid'
  deadline=$(( $(date +%s) + LOAD_WAIT_SECONDS ))
  while true; do
    load="$(load_value)"
    [[ "$load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'load average could not be read'
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    samples="$(python3 - "$samples" "$now" "$load" "$maximum" <<'PY'
import json,sys
items=json.loads(sys.argv[1]); items.append({'at':sys.argv[2], 'load':float(sys.argv[3]), 'maximum':float(sys.argv[4])})
print(json.dumps(items,separators=(',',':')))
PY
)"
    if awk "BEGIN {exit !($load < $maximum)}"; then
      consecutive=$((consecutive + 1))
      log "load sample ${consecutive}/${LOAD_SAMPLE_COUNT} passed at ${stage}: ${load}/${maximum}"
      if ((consecutive >= LOAD_SAMPLE_COUNT)); then
        LAST_LOAD_SAMPLES="$samples"
        return 0
      fi
    else
      consecutive=0
      log "load sample reset at ${stage}: ${load}/${maximum}"
    fi
    if (( $(date +%s) >= deadline )); then
      LAST_LOAD_SAMPLES="$samples"
      die "load average did not remain below ${maximum} for ${LOAD_SAMPLE_COUNT} samples within ${LOAD_WAIT_SECONDS}s (${stage})"
    fi
    sleep "$LOAD_SAMPLE_INTERVAL_SECONDS"
  done
}

image_matches_candidate() {
  local image="$1" config_hash="$2" revision hash
  docker image inspect "$image" >/dev/null 2>&1 || return 1
  revision="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null || true)"
  hash="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.config-hash" }}' "$image" 2>/dev/null || true)"
  [[ "$revision" == "$REF" && "$hash" == "$config_hash" ]]
}

deploy_control_token() {
  local token
  token="$(awk -F= '$1 == "DEPLOY_CONTROL_TOKEN" {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE" 2>/dev/null || true)"
  [[ -n "$token" ]] || token="$(awk -F= '$1 == "JWT_ACCESS_SECRET" {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE" 2>/dev/null || true)"
  [[ -n "$token" ]] || die 'deploy control token is missing from the protected environment file'
  printf '%s\n' "$token"
}

active_api_container() {
  local slot candidate
  if [[ -f "${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json" ]]; then
    slot="$(python3 - "${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json" <<'PY' 2>/dev/null || true
import json,sys
try:
  value=json.load(open(sys.argv[1],encoding='utf-8')).get('activeSlot')
  print(value if value in {'blue','green'} else '')
except Exception:
  pass
PY
)"
    if [[ -n "$slot" ]]; then
      candidate="$(docker ps -q --filter "label=com.docker.compose.service=api-${slot}" | head -1)"
      [[ -n "$candidate" ]] && { printf '%s\n' "$candidate"; return; }
    fi
  fi
  docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" ps -q api 2>/dev/null | head -1
}

set_signage_paused() {
  local action="$1" token status
  [[ "$DRY_RUN" == 1 ]] && { log "DRY-RUN: ${action} signage renderer"; return 0; }
  [[ -n "$SIGNAGE_CONTAINER_ID" ]] || SIGNAGE_CONTAINER_ID="$(active_api_container)"
  [[ -n "$SIGNAGE_CONTAINER_ID" ]] || die 'active API container is unavailable for signage deploy control'
  token="$(deploy_control_token)"
  status="$(docker exec -e "DEPLOY_CONTROL_TOKEN=${token}" "$SIGNAGE_CONTAINER_ID" node -e '
const action=process.argv[1];
fetch("http://127.0.0.1:8080/api/system/deploy-workload/internal", {method:"POST",headers:{"content-type":"application/json","x-deploy-control-token":process.env.DEPLOY_CONTROL_TOKEN},body:JSON.stringify({action})})
  .then(async response=>{if(!response.ok) throw new Error(await response.text()); process.stdout.write(await response.text())})
  .catch(error=>{console.error(error);process.exit(1)})
' "$action")" || die "could not ${action} signage renderer"
  log "signage deploy control completed: ${status}"
}

pause_signage() {
  set_signage_paused pause-signage
  SIGNAGE_PAUSED=1
}

resume_signage() {
  ((SIGNAGE_PAUSED == 1)) || return 0
  set_signage_paused resume-signage || log 'WARNING: could not resume signage renderer'
  SIGNAGE_PAUSED=0
}

image_deploy_cleanup() {
  resume_signage
  if [[ -n "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

migration_guard() {
  ((FORCE_DESTRUCTIVE_MIGRATION == 1)) && return 0
  local base_ref="${PI5_MIGRATION_BASE_REF:-${REF}^}" file changed_files=()
  git -C "$PROJECT_DIR" cat-file -e "${base_ref}^{commit}" 2>/dev/null || die "migration base commit is unavailable: $base_ref"
  while IFS= read -r file; do
    [[ -n "$file" ]] && changed_files+=("$PROJECT_DIR/$file")
  done < <(git -C "$PROJECT_DIR" diff --diff-filter=AM --name-only "$base_ref" "$REF" -- 'apps/api/prisma/migrations/*/migration.sql')
  ((${#changed_files[@]} == 0)) && return 0
  if grep -Ein '(^|[[:space:]])(DROP[[:space:]]+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE)|ALTER[[:space:]].*(RENAME|SET[[:space:]]+NOT[[:space:]]+NULL|DROP[[:space:]]+CONSTRAINT)|TRUNCATE|DELETE[[:space:]]+FROM)([[:space:]]|;)' "${changed_files[@]}" >/dev/null 2>&1; then
    die "destructive Prisma migration detected; phase 2 permits Expand-only changes"
  fi
}

prepare() {
  require_sha; resource_guard; migration_guard
  local tag api web candidate_name config_hash build_mode
  config_hash="$(candidate_config_hash)"
  tag="${REF}-${config_hash:0:12}"
  api="${API_REPOSITORY}:${tag}"; web="${WEB_REPOSITORY}:${tag}"; candidate_name="pi5-api-candidate-${REF:0:12}"
  pause_signage
  wait_for_stable_load pre-build
  if [[ "$DRY_RUN" != 1 ]] && image_matches_candidate "$api" "$config_hash" && image_matches_candidate "$web" "$config_hash"; then
    build_mode=reused
    log "reusing exact candidate images for ${REF}"
  else
    build_mode=built
    log "building candidate images serially while production remains active"
    if [[ "$DRY_RUN" == "1" ]]; then
      printf 'DRY-RUN: PI5_API_IMAGE=%q PI5_WEB_IMAGE=%q docker compose build --build-arg BUILD_COMMIT=%q --build-arg BUILD_CONFIG_HASH=%q api then web\n' "$api" "$web" "$REF" "$config_hash"
    else
      compose "$api" "$web" build --build-arg "BUILD_COMMIT=${REF}" --build-arg "BUILD_CONFIG_HASH=${config_hash}" api
      compose "$api" "$web" build --build-arg "BUILD_COMMIT=${REF}" --build-arg "BUILD_CONFIG_HASH=${config_hash}" web
    fi
  fi
  run env PI5_API_IMAGE="$api" PI5_WEB_IMAGE="$web" docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$PHASE2_COMPOSE" config --quiet
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
    docker rm -f "$candidate_name" >/dev/null 2>&1 || true
    compose "$api" "$web" run -d --no-deps -e PI5_CANDIDATE_VALIDATION=1 -e SIGNAGE_RENDER_ENABLED=false --name "$candidate_name" api >/dev/null
    for _ in $(seq 1 30); do
      if docker exec "$candidate_name" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
      sleep 2
    done
    if ! docker exec "$candidate_name" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      docker rm -f "$candidate_name" >/dev/null 2>&1 || true
      die "candidate API health check failed"
    fi
    docker rm -f "$candidate_name" >/dev/null
  fi
  wait_for_stable_load post-build
  atomic_state prepared "$api" "$web" "" "" success "$build_mode"
  log "candidate prepared: ${REF}"
}

current_image() {
  local service="$1" cid
  cid="$(docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" ps -q "$service")"
  [[ -n "$cid" ]] || die "production service is not running: $service"
  docker inspect -f '{{.Config.Image}}' "$cid"
}

wait_external() {
  local url="$1"
  for _ in $(seq 1 15); do curl -kfsS --max-time 2 "$url" >/dev/null && return 0; sleep 2; done
  return 1
}

wait_web_normal() {
  local body
  for _ in $(seq 1 15); do
    body="$(curl -kfsS --max-time 2 "$WEB_URL" 2>/dev/null || true)"
    if [[ -n "$body" && "$body" != *"ただいま更新中です"* ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_api_internal() {
  local cid
  for _ in $(seq 1 30); do
    cid="$(docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" ps -q api 2>/dev/null || true)"
    if [[ -n "$cid" ]] && docker exec "$cid" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

web_container_id() {
  local cid
  cid="$(docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" ps -q web)"
  [[ -n "$cid" ]] || die "production web service is not running"
  printf '%s\n' "$cid"
}

maintenance_template_for_web() {
  local cid="$1" environment
  environment="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid")"
  if grep -q '^USE_LOCAL_CERTS=' <<<"$environment"; then
    printf '%s\n' "$PROJECT_DIR/infrastructure/docker/Caddyfile.maintenance.local"
  elif grep -q '^DOMAIN=' <<<"$environment"; then
    printf '%s\n' "$PROJECT_DIR/infrastructure/docker/Caddyfile.maintenance.production"
  else
    printf '%s\n' "$PROJECT_DIR/infrastructure/docker/Caddyfile.maintenance.http"
  fi
}

enable_maintenance() {
  local cid template status
  cid="$(web_container_id)"
  template="$(maintenance_template_for_web "$cid")"
  docker exec "$cid" mkdir -p /tmp/pi5-maintenance
  docker cp "$PROJECT_DIR/infrastructure/docker/maintenance.html" "$cid:/tmp/pi5-maintenance/index.html"
  docker cp "$template" "$cid:/tmp/pi5-maintenance.Caddyfile"
  docker exec "$cid" caddy reload --config /tmp/pi5-maintenance.Caddyfile
  status="$(curl -ksS -o /dev/null -w '%{http_code}' --max-time 5 "$MAINTENANCE_URL" || true)"
  if [[ "$status" != "200" ]]; then
    log "ERROR: maintenance page did not become reachable (HTTP ${status:-none})"
    return 1
  fi
  log "global maintenance page enabled"
}

restore_images() {
  local api="$1" web="$2"
  log "restoring previous images"
  compose "$api" "$web" up -d --no-build --force-recreate api
  wait_api_internal
  compose "$api" "$web" up -d --no-build --force-recreate web
  wait_web_normal
  wait_external "$HEALTH_URL"
}

switch_candidate() {
  require_sha; migration_guard
  local tag api web previous_api previous_web started
  tag="$(candidate_tag)"
  api="${API_REPOSITORY}:${tag}"; web="${WEB_REPOSITORY}:${tag}"
  [[ "$(read_state_value candidate.api)" == "$api" ]] || die "candidate was not prepared: $api"
  docker image inspect "$api" "$web" >/dev/null || die "candidate image is missing"
  previous_api="$(current_image api)"; previous_web="$(current_image web)"; started="$(date +%s)"
  atomic_state switching "$api" "$web" "$previous_api" "$previous_web"
  set +e
  enable_maintenance && \
  compose "$api" "$web" run --rm --no-deps api sh -lc './node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma migrate status' && \
    compose "$api" "$web" up -d --no-build --force-recreate api && wait_api_internal && \
    compose "$api" "$web" up -d --no-build --force-recreate web && wait_web_normal && wait_external "$HEALTH_URL"
  local rc=$?
  set -e
  if ((rc != 0)); then
    restore_images "$previous_api" "$previous_web" || true
    atomic_state rolled-back "$api" "$web" "$previous_api" "$previous_web" failure
    die "switch failed; previous images were restored"
  fi
  local elapsed=$(( $(date +%s) - started ))
  atomic_state active "$api" "$web" "$previous_api" "$previous_web" "success:${elapsed}s"
  log "switch completed in ${elapsed}s"
}

rollback() {
  local api web active_api active_web candidate_api candidate_web
  [[ "$(read_state_value rollbackEligible)" == "True" || "$(read_state_value rollbackEligible)" == "true" ]] || die "rollback is not eligible for the current candidate state"
  api="$(read_state_value previous.api)"; web="$(read_state_value previous.web)"
  active_api="$(read_state_value active.api)"; active_web="$(read_state_value active.web)"
  candidate_api="$(read_state_value candidate.api)"; candidate_web="$(read_state_value candidate.web)"
  [[ "$(current_image api)" == "$active_api" ]] || die "running API image does not match the recorded active image; refusing rollback"
  [[ "$(current_image web)" == "$active_web" ]] || die "running Web image does not match the recorded active image; refusing rollback"
  if ! enable_maintenance; then
    log "WARN: maintenance page could not be enabled; continuing with rollback"
  fi
  restore_images "$api" "$web"
  atomic_state rolled-back "$active_api" "$active_web" "$api" "$web" success
}

cleanup() {
  local keep
  keep="$(python3 - "$STATE_FILE" <<'PY'
import json,sys
with open(sys.argv[1]) as f:s=json.load(f)
print('\n'.join(v for group in ('candidate','previous') for v in s.get(group,{}).values()))
PY
)"
  for repo in "$API_REPOSITORY" "$WEB_REPOSITORY"; do
    docker image ls "$repo" --format '{{.Repository}}:{{.Tag}}' | while read -r image; do
      grep -Fxq "$image" <<<"$keep" || run docker image rm "$image"
    done
  done
}

mkdir -p "$(dirname "$LOCK_FILE")"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "another Pi5 image deployment is running"
else
  LOCK_DIR="${LOCK_FILE}.d"
  mkdir "$LOCK_DIR" 2>/dev/null || die "another Pi5 image deployment is running"
fi
# One combined EXIT hook is intentionally installed after the lock is held.
# Do not replace it in prepare: both the signage pause and fallback lock must
# be cleaned up on every success, failure, and signal path.
trap image_deploy_cleanup EXIT
case "$COMMAND" in
  prepare) prepare ;;
  switch) switch_candidate ;;
  rollback) rollback ;;
  status) [[ -f "$STATE_FILE" ]] && python3 -m json.tool "$STATE_FILE" || echo '{"state":"not-initialized"}' ;;
  cleanup) cleanup ;;
  *) usage; exit 2 ;;
esac
