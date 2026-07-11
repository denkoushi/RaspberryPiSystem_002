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
MIN_FREE_MEMORY_MB="${PI5_MIN_FREE_MEMORY_MB:-768}"
MIN_FREE_DISK_GB="${PI5_MIN_FREE_DISK_GB:-10}"
DRY_RUN="${PI5_DEPLOY_DRY_RUN:-0}"
FORCE_DESTRUCTIVE_MIGRATION=0
REF=""

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
  local event="$1" api_image="$2" web_image="$3" previous_api="${4:-}" previous_web="${5:-}" result="${6:-}"
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$event" "$api_image" "$web_image" "$previous_api" "$previous_web" "$result" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, event, api, web, prev_api, prev_web, result = sys.argv[1:]
try:
    with open(path, encoding="utf-8") as f: state = json.load(f)
except (FileNotFoundError, json.JSONDecodeError): state = {"version": 1}
state.update({"event": event, "updatedAt": datetime.now(timezone.utc).isoformat(),
              "candidate": {"api": api, "web": web}})
if prev_api or prev_web: state["previous"] = {"api": prev_api, "web": prev_web}
if result: state["result"] = result
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

migration_guard() {
  ((FORCE_DESTRUCTIVE_MIGRATION == 1)) && return 0
  local base_ref="${PI5_MIGRATION_BASE_REF:-${REF}^}" file changed_files=()
  git -C "$PROJECT_DIR" cat-file -e "${base_ref}^{commit}" 2>/dev/null || die "migration base commit is unavailable: $base_ref"
  while IFS= read -r file; do
    [[ -n "$file" ]] && changed_files+=("$PROJECT_DIR/$file")
  done < <(git -C "$PROJECT_DIR" diff --diff-filter=AM --name-only "$base_ref" "$REF" -- 'apps/api/prisma/migrations/*/migration.sql')
  ((${#changed_files[@]} == 0)) && return 0
  if grep -Ein '(^|[[:space:]])(DROP[[:space:]]+(TABLE|COLUMN|INDEX)|ALTER[[:space:]].*RENAME|TRUNCATE)([[:space:]]|;)' "${changed_files[@]}" >/dev/null 2>&1; then
    die "destructive Prisma migration detected; phase 2 permits Expand-only changes"
  fi
}

prepare() {
  require_sha; resource_guard; migration_guard
  local api="${API_REPOSITORY}:${REF}" web="${WEB_REPOSITORY}:${REF}" candidate_name="pi5-api-candidate-${REF:0:12}"
  log "building candidate images while production remains active"
  run docker build -f "$PROJECT_DIR/infrastructure/docker/Dockerfile.api" -t "$api" "$PROJECT_DIR"
  run docker build -f "$PROJECT_DIR/infrastructure/docker/Dockerfile.web" -t "$web" "$PROJECT_DIR"
  run env PI5_API_IMAGE="$api" PI5_WEB_IMAGE="$web" docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$PHASE2_COMPOSE" config --quiet
  run docker run --rm "$web" sh -ec 'envsubst < /srv/Caddyfile.local.template > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile'
  if [[ "$DRY_RUN" != "1" ]]; then
    docker rm -f "$candidate_name" >/dev/null 2>&1 || true
    compose "$api" "$web" run -d --no-deps --name "$candidate_name" api >/dev/null
    trap 'docker rm -f "$candidate_name" >/dev/null 2>&1 || true' RETURN
    for _ in $(seq 1 30); do
      if docker exec "$candidate_name" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
      sleep 2
    done
    docker exec "$candidate_name" node -e "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || die "candidate API health check failed"
    docker rm -f "$candidate_name" >/dev/null
    trap - RETURN
  fi
  atomic_state prepared "$api" "$web" "" "" success
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

restore_images() {
  local api="$1" web="$2"
  log "restoring previous images"
  compose "$api" "$web" up -d --no-build --force-recreate api
  wait_external "$HEALTH_URL"
  compose "$api" "$web" up -d --no-build --force-recreate web
  wait_external "$WEB_URL"
}

switch_candidate() {
  require_sha; migration_guard
  local api="${API_REPOSITORY}:${REF}" web="${WEB_REPOSITORY}:${REF}" previous_api previous_web started
  [[ "$(read_state_value candidate.api)" == "$api" ]] || die "candidate was not prepared: $api"
  docker image inspect "$api" "$web" >/dev/null || die "candidate image is missing"
  previous_api="$(current_image api)"; previous_web="$(current_image web)"; started="$(date +%s)"
  atomic_state switching "$api" "$web" "$previous_api" "$previous_web"
  set +e
  compose "$api" "$web" run --rm --no-deps api pnpm prisma migrate deploy && \
    compose "$api" "$web" run --rm --no-deps api pnpm prisma migrate status && \
    compose "$api" "$web" up -d --no-build --force-recreate api && wait_external "$HEALTH_URL" && \
    compose "$api" "$web" up -d --no-build --force-recreate web && wait_external "$WEB_URL"
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
  local api web candidate_api candidate_web
  api="$(read_state_value previous.api)"; web="$(read_state_value previous.web)"
  candidate_api="$(read_state_value candidate.api)"; candidate_web="$(read_state_value candidate.web)"
  restore_images "$api" "$web"
  atomic_state rolled-back "$candidate_api" "$candidate_web" "$api" "$web" success
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
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi
case "$COMMAND" in
  prepare) prepare ;;
  switch) switch_candidate ;;
  rollback) rollback ;;
  status) [[ -f "$STATE_FILE" ]] && python3 -m json.tool "$STATE_FILE" || echo '{"state":"not-initialized"}' ;;
  cleanup) cleanup ;;
  *) usage; exit 2 ;;
esac
