#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_IMAGE=""
WEB_IMAGE=""
SHA=""
STABLE_SECONDS=300
PLATFORM=linux/arm64
PULL_IMAGES=1

usage() {
  echo 'Usage: rehearse-release-runtime.sh --api-image IMAGE --web-image IMAGE --sha FULL_SHA [--platform linux/arm64|linux/amd64] [--skip-pull] [--stable-seconds N]'
}

while (($#)); do
  case "$1" in
    --api-image) API_IMAGE="${2:-}"; shift 2 ;;
    --web-image) WEB_IMAGE="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --skip-pull) PULL_IMAGES=0; shift ;;
    # This is an isolated CI harness, not a production controller. Main CI
    # omits this option and therefore always proves the fixed 300-second hold.
    --stable-seconds) STABLE_SECONDS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ -n "$API_IMAGE" && -n "$WEB_IMAGE" ]] || { usage >&2; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '[ERROR] release SHA is malformed' >&2; exit 78; }
[[ "$STABLE_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo '[ERROR] stability duration is invalid' >&2; exit 78; }
[[ "$PLATFORM" == linux/arm64 || "$PLATFORM" == linux/amd64 ]] \
  || { echo '[ERROR] rehearsal platform must be linux/arm64 or linux/amd64' >&2; exit 78; }
if [[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/main ]]; then
  if [[ "$STABLE_SECONDS" != 300 || "$PLATFORM" != linux/arm64 || "$PULL_IMAGES" != 1 ]]; then
    echo '[ERROR] exact-main release rehearsal requires pulled ARM64 digests and the fixed 300-second hold' >&2
    exit 78
  fi
fi

FAILURE_STAGE='run-setup'
report_failure() {
  local status=$? line="$1"
  printf '[ERROR] release-runtime-audit failure stage=%s line=%s status=%s\n' \
    "$FAILURE_STAGE" "$line" "$status" >&2
  return "$status"
}

RUN_SUFFIX="$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"
RUN_ID="raspi-release-runtime-audit-${RUN_SUFFIX}"
LABEL_KEY='com.raspi-system.production-path-audit'
LABEL="${LABEL_KEY}=true"
RUN_LABEL_KEY='com.raspi-system.production-path-audit.run'
RUN_LABEL="${RUN_LABEL_KEY}=${RUN_ID}"
NETWORK="${RUN_ID}-network"
DB_CONTAINER="${RUN_ID}-db"
API_BLUE="${RUN_ID}-api-blue"
API_GREEN="${RUN_ID}-api-green"
WEB_BLUE="${RUN_ID}-web-blue"
WEB_GREEN="${RUN_ID}-web-green"
GATEWAY="${RUN_ID}-gateway"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${RUN_ID}.XXXXXX")"
declare -a VOLUMES=()
declare -a CONTAINERS=("$DB_CONTAINER" "$API_BLUE" "$API_GREEN" "$WEB_BLUE" "$WEB_GREEN" "$GATEWAY")

cleanup() {
  local status=$? residue=0
  local -a labelled_containers=()
  set +e
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1
  while IFS= read -r container; do
    [[ -n "$container" ]] && labelled_containers+=("$container")
  done < <(docker ps -aq --filter "label=${RUN_LABEL}" 2>/dev/null)
  if ((${#labelled_containers[@]})); then
    docker rm -f "${labelled_containers[@]}" >/dev/null 2>&1
  fi
  for volume in "${VOLUMES[@]}"; do
    docker volume rm "$volume" >/dev/null 2>&1
  done
  docker network rm "$NETWORK" >/dev/null 2>&1
  rm -rf "$TEMP_DIR"
  [[ -z "$(docker ps -aq --filter "label=${RUN_LABEL}" 2>/dev/null)" ]] || residue=1
  [[ -z "$(docker network ls -q --filter "label=${RUN_LABEL}" 2>/dev/null)" ]] || residue=1
  [[ -z "$(docker volume ls -q --filter "label=${RUN_LABEL}" 2>/dev/null)" ]] || residue=1
  if ((residue)); then
    echo '[ERROR] production-path audit Docker resources remain after cleanup' >&2
    status=1
  else
    echo '[release-runtime-audit] cleanup verified: containers=0 networks=0 volumes=0'
  fi
  trap - EXIT INT TERM
  exit "$status"
}
trap cleanup EXIT INT TERM
trap 'report_failure "$LINENO"' ERR

FAILURE_STAGE='image-validation'
if ((PULL_IMAGES)); then
  docker pull --platform "$PLATFORM" "$API_IMAGE" >/dev/null
  docker pull --platform "$PLATFORM" "$WEB_IMAGE" >/dev/null
fi
for image in "$API_IMAGE" "$WEB_IMAGE"; do
  [[ "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" == "$PLATFORM" ]]
  [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$SHA" ]]
done
API_UID="$(docker run --rm --platform "$PLATFORM" --entrypoint id "$API_IMAGE" -u)"
API_GID="$(docker run --rm --platform "$PLATFORM" --entrypoint id "$API_IMAGE" -g)"
WEB_UID="$(docker run --rm --platform "$PLATFORM" --entrypoint id "$WEB_IMAGE" -u)"
WEB_GID="$(docker run --rm --platform "$PLATFORM" --entrypoint id "$WEB_IMAGE" -g)"
for identity in "$API_UID" "$API_GID" "$WEB_UID" "$WEB_GID"; do
  [[ "$identity" =~ ^[1-9][0-9]*$ ]] || { echo '[ERROR] release image must use a numeric non-root identity' >&2; exit 1; }
done

docker network create --label "$LABEL" --label "$RUN_LABEL" "$NETWORK" >/dev/null

FAILURE_STAGE='database-readiness'
new_volume() {
  local purpose="$1"
  NEW_VOLUME="${RUN_ID}-${purpose}"
  docker volume create --label "$LABEL" --label "$RUN_LABEL" "$NEW_VOLUME" >/dev/null
  VOLUMES+=("$NEW_VOLUME")
}

prepare_writable_volume() {
  local volume="$1" image="$2" uid="$3" gid="$4"
  docker run --rm --platform "$PLATFORM" --label "$LABEL" --label "$RUN_LABEL" \
    --user 0 -v "$volume:/target" --entrypoint chown "$image" \
    -R "${uid}:${gid}" /target
}

new_volume db
DB_VOLUME="$NEW_VOLUME"
docker run -d --platform "$PLATFORM" --name "$DB_CONTAINER" --network "$NETWORK" --network-alias db \
  --label "$LABEL" --label "$RUN_LABEL" -v "$DB_VOLUME:/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=borrow_return \
  pgvector/pgvector:pg15 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$DB_CONTAINER" pg_isready -U postgres -d borrow_return >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -U postgres -d borrow_return >/dev/null

FAILURE_STAGE='migration-and-role-bootstrap'
MIGRATION_PASSWORD='audit-migration-password'
APP_PASSWORD='audit-application-password'
BOOTSTRAP_DATABASE_URL='postgresql://postgres:postgres@db:5432/borrow_return'
docker run --rm --platform "$PLATFORM" --network "$NETWORK" --read-only --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --label "$LABEL" --label "$RUN_LABEL" -e "BOOTSTRAP_DATABASE_URL=${BOOTSTRAP_DATABASE_URL}" --entrypoint sh "$API_IMAGE" \
  -lc 'DATABASE_URL="$BOOTSTRAP_DATABASE_URL" exec ./node_modules/.bin/prisma migrate deploy' >/dev/null
docker exec -i "$DB_CONTAINER" psql -U postgres -d borrow_return \
  -v migration_password="$MIGRATION_PASSWORD" -v app_password="$APP_PASSWORD" \
  -f - <"$ROOT/scripts/deploy/postgres-role-bootstrap.sql" >/dev/null
MIGRATION_URL="postgresql://raspi_migrator:${MIGRATION_PASSWORD}@db:5432/borrow_return"
APP_URL="postgresql://raspi_app:${APP_PASSWORD}@db:5432/borrow_return"
docker run --rm --platform "$PLATFORM" --network "$NETWORK" --read-only --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --label "$LABEL" --label "$RUN_LABEL" -e "MIGRATION_DATABASE_URL=${MIGRATION_URL}" --entrypoint sh "$API_IMAGE" \
  -lc 'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate deploy' >/dev/null
docker run --rm --platform "$PLATFORM" --network "$NETWORK" --read-only --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --label "$LABEL" --label "$RUN_LABEL" -e "MIGRATION_DATABASE_URL=${MIGRATION_URL}" --entrypoint sh "$API_IMAGE" \
  -lc 'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate status' >/dev/null

COMPOSE_ENV="$TEMP_DIR/compose.env"
MIGRATION_ENV="$TEMP_DIR/migration.env"
FAILURE_STAGE='compose-and-storage-validation'
printf 'MIGRATION_DATABASE_URL=%s\n' "$MIGRATION_URL" >"$MIGRATION_ENV"
cat >"$COMPOSE_ENV" <<EOF
ADMIN_ALLOW_NETS=127.0.0.1/32
JWT_ACCESS_SECRET=audit-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz
JWT_REFRESH_SECRET=audit-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz
APP_DATABASE_URL=${APP_URL}
POSTGRES_SUPERUSER_PASSWORD_FILE=${TEMP_DIR}/postgres-password
MIGRATION_DATABASE_ENV_FILE=${MIGRATION_ENV}
EOF
printf 'postgres\n' >"$TEMP_DIR/postgres-password"
PI5_BLUE_API_IMAGE="$API_IMAGE" PI5_GREEN_API_IMAGE="$API_IMAGE" \
PI5_BLUE_WEB_IMAGE="$WEB_IMAGE" PI5_GREEN_WEB_IMAGE="$WEB_IMAGE" \
PI5_GATEWAY_IMAGE="$WEB_IMAGE" PI5_PROJECT_DIR="$ROOT" PI5_ENV_FILE="$COMPOSE_ENV" \
  docker compose --env-file "$COMPOSE_ENV" \
    -f "$ROOT/infrastructure/docker/docker-compose.phase3.yml" \
    -f "$ROOT/infrastructure/docker/docker-compose.phase3.migration.yml" \
    config --format json >"$TEMP_DIR/phase3.json"

python3 - "$TEMP_DIR/phase3.json" "$TEMP_DIR/storage-targets" <<'PY'
import json, pathlib, sys
model = json.load(open(sys.argv[1], encoding='utf-8'))
mounts = model['services']['api-blue']['volumes']
targets = sorted(
    item['target'] for item in mounts
    if isinstance(item, dict) and item.get('target', '').startswith('/app/storage/')
)
required = {
    '/app/storage/photos',
    '/app/storage/thumbnails',
    '/app/storage/pdfs',
    '/app/storage/pdf-pages',
    '/app/storage/signage-rendered',
    '/app/storage/part-measurement-drawings',
    '/app/storage/part-measurement-drawings-derivatives',
    '/app/storage/assembly-procedure-images',
    '/app/storage/measuring-instrument-genres',
    '/app/storage/pallet-machine-illustrations',
    '/app/storage/csv-dashboards',
    '/app/storage/.integrity',
}
if set(targets) != required:
    raise SystemExit(f'production storage targets differ: {sorted(required - set(targets))}')
pathlib.Path(sys.argv[2]).write_text('\n'.join(targets) + '\n', encoding='utf-8')
PY

declare -a API_MOUNTS=()
while IFS= read -r target; do
  purpose="storage-$(python3 -c 'import re,sys; print(re.sub(r"[^a-z0-9]+", "-", sys.argv[1].lower()).strip("-"))' "$target")"
  new_volume "$purpose"
  volume="$NEW_VOLUME"
  prepare_writable_volume "$volume" "$API_IMAGE" "$API_UID" "$API_GID"
  API_MOUNTS+=("-v" "${volume}:${target}")
done <"$TEMP_DIR/storage-targets"
for target in alerts power-actions config backups; do
  new_volume "$target"
  volume="$NEW_VOLUME"
  prepare_writable_volume "$volume" "$API_IMAGE" "$API_UID" "$API_GID"
  case "$target" in
    alerts) destination=/app/alerts ;;
    power-actions) destination=/app/power-actions ;;
    config) destination=/app/config ;;
    backups) destination=/opt/backups ;;
  esac
  API_MOUNTS+=("-v" "${volume}:${destination}")
done
new_volume caddy-log
CADDY_LOG="$NEW_VOLUME"
prepare_writable_volume "$CADDY_LOG" "$WEB_IMAGE" "$WEB_UID" "$WEB_GID"

API_ENV=(
  -e NODE_ENV=production
  -e "DATABASE_URL=${APP_URL}"
  -e JWT_ACCESS_SECRET=audit-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz
  -e JWT_REFRESH_SECRET=audit-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz
  -e PORT=8080 -e HOST=0.0.0.0 -e CAMERA_TYPE=mock
  -e FILE_STORAGE_ROOT=/app/storage -e PHOTO_STORAGE_DIR=/app/storage
  -e PDF_STORAGE_DIR=/app/storage -e CSV_DASHBOARD_STORAGE_DIR=/app/storage
  -e SIGNAGE_RENDER_DIR=/app/storage/signage-rendered
  -e ALERTS_DIR=/app/alerts -e POWER_ACTIONS_DIR=/app/power-actions
  -e BACKUP_STORAGE_DIR=/opt/backups -e PI5_SCHEDULER_LEADER_ENABLED=1
  -e PI5_SCHEDULER_LEASE_FILE=/app/alerts/.pi5-scheduler-leader
)
FAILURE_STAGE='api-health-and-scheduler'
for pair in "$API_BLUE:api-blue" "$API_GREEN:api-green"; do
  name="${pair%%:*}" alias="${pair#*:}"
  docker run -d --platform "$PLATFORM" --name "$name" --network "$NETWORK" --network-alias "$alias" \
    --label "$LABEL" --label "$RUN_LABEL" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=1g \
    "${API_MOUNTS[@]}" "${API_ENV[@]}" "$API_IMAGE" >/dev/null
done
for name in "$API_BLUE" "$API_GREEN"; do
  for _ in $(seq 1 90); do
    docker exec "$name" node -e \
      "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1 && break
    sleep 2
  done
  docker exec "$name" node -e \
    "fetch('http://127.0.0.1:8080/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null
done
declare -a SCHEDULER_ROLES=()
for name in "$API_BLUE" "$API_GREEN"; do
  role="$(docker exec "$name" node -e \
    "fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal').then(async r=>{const b=await r.json(); const s=b.scheduler||{}; if(!r.ok||b.ready!==true||b.database!=='ready'||s.enabled!==true||s.databaseConnection!=='connected'||!['leader','standby'].includes(s.role))process.exit(1); console.log(s.role)}).catch(()=>process.exit(1))")"
  SCHEDULER_ROLES+=("$role")
done
[[ "$(printf '%s\n' "${SCHEDULER_ROLES[@]}" | sort | tr '\n' ' ')" == 'leader standby ' ]] \
  || { echo '[ERROR] exact API pair did not elect one scheduler leader and one standby' >&2; exit 1; }

FAILURE_STAGE='web-health'
for pair in "$WEB_BLUE:web-blue:api-blue" "$WEB_GREEN:web-green:api-green"; do
  name="${pair%%:*}" rest="${pair#*:}" alias="${rest%%:*}" upstream="${rest#*:}"
  docker run -d --platform "$PLATFORM" --name "$name" --network "$NETWORK" --network-alias "$alias" \
    --label "$LABEL" --label "$RUN_LABEL" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --sysctl net.ipv4.ip_unprivileged_port_start=80 \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=64m \
    --tmpfs "/config:rw,nosuid,nodev,mode=0700,size=16m,uid=${WEB_UID},gid=${WEB_GID}" \
    --tmpfs "/data:rw,nosuid,nodev,mode=0700,size=64m,uid=${WEB_UID},gid=${WEB_GID}" \
    -v "$CADDY_LOG:/var/log/caddy" -e "SLOT_API_UPSTREAM=${upstream}:8080" \
    "$WEB_IMAGE" >/dev/null
done
for name in "$WEB_BLUE" "$WEB_GREEN"; do
  for _ in $(seq 1 30); do
    docker exec "$name" sh -eu -c '
      test -n "${SLOT_CADDY_CONFIG_FILE:-}"
      test -f "$SLOT_CADDY_CONFIG_FILE"
      caddy validate --config "$SLOT_CADDY_CONFIG_FILE" >/dev/null
    ' >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$name" sh -eu -c '
    test -n "${SLOT_CADDY_CONFIG_FILE:-}"
    test -f "$SLOT_CADDY_CONFIG_FILE"
    caddy validate --config "$SLOT_CADDY_CONFIG_FILE" >/dev/null
  '
done

FAILURE_STAGE='gateway-and-stability'
render_gateway() {
  local slot="$1"
  python3 - "$ROOT/infrastructure/docker/Caddyfile.gateway.http.template" \
    "$TEMP_DIR/Caddyfile" "api-${slot}:8080" "web-${slot}:80" <<'PY'
import pathlib, sys
source, destination, api, web = sys.argv[1:]
value = pathlib.Path(source).read_text(encoding='utf-8')
value = value.replace('__BLUE_GREEN_API_UPSTREAM__', api).replace('__BLUE_GREEN_WEB_UPSTREAM__', web)
pathlib.Path(destination).write_text(value, encoding='utf-8')
PY
}
render_gateway blue
docker run -d --platform "$PLATFORM" --name "$GATEWAY" --network "$NETWORK" --label "$LABEL" --label "$RUN_LABEL" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --sysctl net.ipv4.ip_unprivileged_port_start=80 \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=64m \
  --tmpfs "/config:rw,nosuid,nodev,mode=0700,size=16m,uid=${WEB_UID},gid=${WEB_GID}" \
  --tmpfs "/data:rw,nosuid,nodev,mode=0700,size=64m,uid=${WEB_UID},gid=${WEB_GID}" \
  -v "$CADDY_LOG:/var/log/caddy" -v "$TEMP_DIR/Caddyfile:/srv/bluegreen/Caddyfile:ro" \
  -e GATEWAY_CONFIG_FILE=/srv/bluegreen/Caddyfile -p '127.0.0.1::80' "$WEB_IMAGE" >/dev/null
PORT_RECORD="$(docker port "$GATEWAY" 80/tcp)"
[[ "$PORT_RECORD" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || { echo '[ERROR] gateway port is invalid' >&2; exit 1; }
GATEWAY_PORT="${BASH_REMATCH[1]}"
for _ in $(seq 1 60); do
  curl -fsS --max-time 5 "http://127.0.0.1:${GATEWAY_PORT}/api/system/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 5 "http://127.0.0.1:${GATEWAY_PORT}/api/system/health" >/dev/null
curl -fsS --max-time 5 "http://127.0.0.1:${GATEWAY_PORT}/" >/dev/null

render_gateway green
docker exec "$GATEWAY" caddy reload --config /srv/bluegreen/Caddyfile >/dev/null
started="$(date +%s)"
samples=0
while (( $(date +%s) - started < STABLE_SECONDS )); do
  curl -fsS --max-time 5 "http://127.0.0.1:${GATEWAY_PORT}/api/system/health" >/dev/null
  curl -fsS --max-time 5 "http://127.0.0.1:${GATEWAY_PORT}/" >/dev/null
  samples=$((samples + 1))
  sleep 2
done
((samples > 0))

if docker exec -e PGPASSWORD="$APP_PASSWORD" "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U raspi_app -d borrow_return -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE audit_forbidden (id integer);' >/dev/null 2>&1; then
  echo '[ERROR] application role unexpectedly obtained DDL authority' >&2
  exit 1
fi

FAILURE_STAGE='standard-candidate-fresh-lifecycle'
BASE_SHA="${STANDARD_CANDIDATE_BASE_SHA:-$(git merge-base HEAD origin/main)}"
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '[ERROR] candidate base SHA is malformed' >&2; exit 78; }
BASE_CONTRACT="$TEMP_DIR/base-release-contract.json"
bash "$ROOT/scripts/ci/render-release-build-contract.sh" \
  --inventory "$ROOT/infrastructure/ansible/inventory.yml" \
  --sha "$BASE_SHA" --output "$BASE_CONTRACT"
BASE_CONFIG_HASH="$(python3 "$ROOT/scripts/deploy/release_build_contract.py" hash \
  --release-sha "$BASE_SHA" <"$BASE_CONTRACT")"
DESIRED_API="ghcr.io/denkoushi/raspisys-api:${BASE_SHA}-${BASE_CONFIG_HASH:0:16}"
DESIRED_WEB="ghcr.io/denkoushi/raspisys-web:${BASE_SHA}-${BASE_CONFIG_HASH:0:16}"
printf '[standard-candidate] baseSha=%s configHash=%s api=%s web=%s\n' \
  "$BASE_SHA" "$BASE_CONFIG_HASH" "$DESIRED_API" "$DESIRED_WEB"

# Replace the component-level containers with the same production Compose
# topology. The PR-built pair is the active old slot; the published exact-main
# pair is a distinct immutable candidate pulled by the Ansible role itself.
docker rm -f "$API_BLUE" "$API_GREEN" "$WEB_BLUE" "$WEB_GREEN" "$GATEWAY" >/dev/null
CANDIDATE_ROOT="$TEMP_DIR/standard-candidate"
CANDIDATE_DATA="$CANDIDATE_ROOT/data"
CANDIDATE_CONFIG="$CANDIDATE_ROOT/bluegreen"
CANDIDATE_OVERRIDE="$CANDIDATE_ROOT/compose.override.yml"
CANDIDATE_VARS="$CANDIDATE_ROOT/vars.yml"
CANDIDATE_PROJECT="${RUN_ID}-candidate"
mkdir -p "$CANDIDATE_DATA"/{storage,alerts,power-actions,config,backups,caddy-log} "$CANDIDATE_CONFIG"
chmod -R 0777 "$CANDIDATE_DATA"
cat >>"$COMPOSE_ENV" <<EOF
PI5_DOCKER_NETWORK=${NETWORK}
PI5_CADDY_LOG_DIR=${CANDIDATE_DATA}/caddy-log
PI5_BLUE_GREEN_CONFIG_DIR=${CANDIDATE_CONFIG}
PI5_ENV_FILE=${COMPOSE_ENV}
PI5_BLUE_API_IMAGE=${API_IMAGE}
PI5_GREEN_API_IMAGE=${API_IMAGE}
PI5_BLUE_WEB_IMAGE=${WEB_IMAGE}
PI5_GREEN_WEB_IMAGE=${WEB_IMAGE}
PI5_GATEWAY_IMAGE=${WEB_IMAGE}
EOF
cat >"$CANDIDATE_OVERRIDE" <<EOF
services:
  api-blue:
    labels: {${LABEL_KEY}: "true", ${RUN_LABEL_KEY}: "${RUN_ID}"}
    volumes: !override ["${CANDIDATE_DATA}/storage:/app/storage", "${CANDIDATE_DATA}/alerts:/app/alerts", "${CANDIDATE_DATA}/power-actions:/app/power-actions", "${CANDIDATE_DATA}/config:/app/config", "${CANDIDATE_DATA}/backups:/opt/backups"]
  api-green:
    labels: {${LABEL_KEY}: "true", ${RUN_LABEL_KEY}: "${RUN_ID}"}
    volumes: !override ["${CANDIDATE_DATA}/storage:/app/storage", "${CANDIDATE_DATA}/alerts:/app/alerts", "${CANDIDATE_DATA}/power-actions:/app/power-actions", "${CANDIDATE_DATA}/config:/app/config", "${CANDIDATE_DATA}/backups:/opt/backups"]
  web-blue:
    labels: {${LABEL_KEY}: "true", ${RUN_LABEL_KEY}: "${RUN_ID}"}
    volumes: !override ["${CANDIDATE_DATA}/storage/thumbnails:/srv/storage/thumbnails:ro", "${CANDIDATE_DATA}/caddy-log:/var/log/caddy"]
  web-green:
    labels: {${LABEL_KEY}: "true", ${RUN_LABEL_KEY}: "${RUN_ID}"}
    volumes: !override ["${CANDIDATE_DATA}/storage/thumbnails:/srv/storage/thumbnails:ro", "${CANDIDATE_DATA}/caddy-log:/var/log/caddy"]
  gateway:
    labels: {${LABEL_KEY}: "true", ${RUN_LABEL_KEY}: "${RUN_ID}"}
    volumes: !override ["${CANDIDATE_CONFIG}:/srv/bluegreen:ro", "${CANDIDATE_DATA}/caddy-log:/var/log/caddy"]
    ports: !override ["127.0.0.1::80"]
networks:
  pi5:
    external: true
    name: ${NETWORK}
EOF

python3 - "$ROOT/infrastructure/docker/Caddyfile.gateway.http.template" \
  "$CANDIDATE_CONFIG/Caddyfile" <<'PY'
import pathlib, sys
value = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
value = value.replace("__BLUE_GREEN_API_UPSTREAM__", "api-blue:8080")
value = value.replace("__BLUE_GREEN_WEB_UPSTREAM__", "web-blue:80")
pathlib.Path(sys.argv[2]).write_text(value, encoding="utf-8")
PY
CANDIDATE_COMPOSE=(docker compose -p "$CANDIDATE_PROJECT" --env-file "$COMPOSE_ENV" \
  -f "$ROOT/infrastructure/docker/docker-compose.phase3.yml" -f "$CANDIDATE_OVERRIDE")
PI5_BLUE_API_IMAGE="$API_IMAGE" PI5_GREEN_API_IMAGE="$API_IMAGE" \
PI5_BLUE_WEB_IMAGE="$WEB_IMAGE" PI5_GREEN_WEB_IMAGE="$WEB_IMAGE" PI5_GATEWAY_IMAGE="$WEB_IMAGE" \
  "${CANDIDATE_COMPOSE[@]}" up -d --no-build --pull never --wait api-blue web-blue gateway >/dev/null
CANDIDATE_GATEWAY_ID="$("${CANDIDATE_COMPOSE[@]}" ps -q gateway)"
CANDIDATE_PORT_RECORD="$(docker port "$CANDIDATE_GATEWAY_ID" 80/tcp)"
[[ "$CANDIDATE_PORT_RECORD" =~ ^127\.0\.0\.1:([0-9]+)$ ]]
CANDIDATE_PORT="${BASH_REMATCH[1]}"
for _ in $(seq 1 60); do
  docker exec "$("${CANDIDATE_COMPOSE[@]}" ps -q api-blue)" node -e \
    "fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal').then(async r=>{const b=await r.json();process.exit(r.ok&&b.scheduler?.role==='leader'?0:1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$("${CANDIDATE_COMPOSE[@]}" ps -q api-blue)" node -e \
  "fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal').then(async r=>{const b=await r.json();process.exit(r.ok&&b.scheduler?.role==='leader'?0:1)}).catch(()=>process.exit(1))"

cat >"$CANDIDATE_VARS" <<EOF
release_sha: "${BASE_SHA}"
release_run_id: "candidate-${RUN_SUFFIX}"
release_pi5_api_image: "${DESIRED_API}"
release_pi5_web_image: "${DESIRED_WEB}"
release_pi5_candidate_project_dir: "${ROOT}"
release_pi5_candidate_run_root: "${CANDIDATE_ROOT}/runs"
release_pi5_candidate_compose_project: "${CANDIDATE_PROJECT}"
release_pi5_candidate_env_file: "${COMPOSE_ENV}"
release_pi5_candidate_gateway_config_dir: "${CANDIDATE_CONFIG}"
release_pi5_candidate_gateway_template: "${ROOT}/infrastructure/docker/Caddyfile.gateway.http.template"
release_pi5_candidate_api_health_url: "http://127.0.0.1:${CANDIDATE_PORT}/api/system/health"
release_pi5_candidate_web_health_url: "http://127.0.0.1:${CANDIDATE_PORT}/"
release_pi5_candidate_validate_certs: false
release_pi5_candidate_min_memory_mb: 768
release_pi5_candidate_min_disk_gb: 1
release_pi5_candidate_become: false
release_pi5_candidate_compose_argv: [docker, compose, -p, "${CANDIDATE_PROJECT}", --env-file, "${COMPOSE_ENV}", -f, "${ROOT}/infrastructure/docker/docker-compose.phase3.yml", -f, "${CANDIDATE_OVERRIDE}"]
release_pi5_candidate_migration_argv: [docker, compose, -p, "${CANDIDATE_PROJECT}", --env-file, "${COMPOSE_ENV}", -f, "${ROOT}/infrastructure/docker/docker-compose.phase3.yml", -f, "${CANDIDATE_OVERRIDE}", -f, "${ROOT}/infrastructure/docker/docker-compose.phase3.migration.yml"]
EOF
ANSIBLE_ROLES_PATH="$ROOT/infrastructure/ansible/roles" ansible-playbook \
  -i localhost, "$ROOT/infrastructure/ansible/playbooks/verify-pi5-standard-candidate.yml" \
  --extra-vars "@$CANDIDATE_VARS"

grep -Fq 'api-green:8080' "$CANDIDATE_CONFIG/Caddyfile"
grep -Fq 'web-green:80' "$CANDIDATE_CONFIG/Caddyfile"
[[ -z "$("${CANDIDATE_COMPOSE[@]}" ps -a -q api-blue web-blue)" ]]
for service in api-green web-green; do
  [[ "$(docker inspect --format '{{.State.Running}}' "$("${CANDIDATE_COMPOSE[@]}" ps -q "$service")")" == true ]]
done
[[ "$(docker exec "$("${CANDIDATE_COMPOSE[@]}" ps -q api-green)" node -e \
  "fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal').then(async r=>{const b=await r.json();console.log(b.scheduler?.role||'')}).catch(()=>process.exit(1))")" == leader ]]
for _ in 1 2 3; do
  curl -fsS --max-time 5 "http://127.0.0.1:${CANDIDATE_PORT}/api/system/health" >/dev/null
  curl -fsS --max-time 5 "http://127.0.0.1:${CANDIDATE_PORT}/" >/dev/null
done
for pair in "$DESIRED_API|api-green" "$DESIRED_WEB|web-green"; do
  image="${pair%%|*}"; service="${pair##*|}"
  cid="$("${CANDIDATE_COMPOSE[@]}" ps -q "$service")"
  [[ "$(docker inspect --format '{{.Config.Image}}' "$cid")" == "$image" ]]
  [[ "$(docker image inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' "$image")" == "$BASE_SHA" ]]
  [[ "$(docker image inspect --format '{{index .Config.Labels \"org.opencontainers.image.config-hash\"}}' "$image")" == "$BASE_CONFIG_HASH" ]]
done
printf '[standard-candidate] fresh lifecycle passed: baseSha=%s configHash=%s stabilitySeconds=300 active=green\n' \
  "$BASE_SHA" "$BASE_CONFIG_HASH"

printf '[release-runtime-audit] passed: sha=%s stabilitySeconds=%s samples=%s\n' \
  "$SHA" "$STABLE_SECONDS" "$samples"
