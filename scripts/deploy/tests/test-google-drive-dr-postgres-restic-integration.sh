#!/usr/bin/env bash
set -euo pipefail

# This is an opt-in, high-cost integration check. It never connects to the
# repository's normal Compose database: every Docker object is uniquely named,
# labelled, and removed by the EXIT trap below.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PNPM="${ROOT}/scripts/ci/pnpm-exact.sh"
RUN_ID="google-drive-dr-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"
TEMP_LABEL="com.raspi-system.temporary=true"
RUN_LABEL="com.raspi-system.google-drive-dr-test=${RUN_ID}"
DB_CONTAINER="${RUN_ID}-postgres"
DB_VOLUME="${RUN_ID}-volume"
NETWORK="${RUN_ID}-network"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${RUN_ID}.XXXXXX")"
PAYLOAD_DIR="${WORK_DIR}/payload"
RESTORE_DIR="${WORK_DIR}/restore"
RESTIC_REPO="${WORK_DIR}/restic-repository"
RESTIC_IMAGE="${RESTIC_IMAGE:-restic/restic:0.18.0}"
RESTIC_PASSWORD_VALUE='local-integration-only-restic-password'
RESTIC_MODE="host"
PORT=""
STAGE="initialization"

START_CONTAINERS="${WORK_DIR}/starting-containers.txt"
START_VOLUMES="${WORK_DIR}/starting-volumes.txt"
START_NETWORKS="${WORK_DIR}/starting-networks.txt"

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

stage() {
  STAGE="$1"
  printf '[google-drive-dr-integration] stage=%s\n' "$STAGE"
}

capture_starting_docker_ids() {
  docker ps -aq --no-trunc | sort >"$START_CONTAINERS"
  docker volume ls -q | sort >"$START_VOLUMES"
  docker network ls -q --no-trunc | sort >"$START_NETWORKS"
}

assert_starting_docker_ids_unchanged() {
  local current_containers="${WORK_DIR}/ending-containers.txt"
  local current_volumes="${WORK_DIR}/ending-volumes.txt"
  local current_networks="${WORK_DIR}/ending-networks.txt"
  docker ps -aq --no-trunc | sort >"$current_containers"
  docker volume ls -q | sort >"$current_volumes"
  docker network ls -q --no-trunc | sort >"$current_networks"
  [[ -z "$(comm -23 "$START_CONTAINERS" "$current_containers")" ]] || {
    echo '[ERROR] a starting Docker container ID disappeared' >&2
    return 1
  }
  [[ -z "$(comm -23 "$START_VOLUMES" "$current_volumes")" ]] || {
    echo '[ERROR] a starting Docker volume ID disappeared' >&2
    return 1
  }
  [[ -z "$(comm -23 "$START_NETWORKS" "$current_networks")" ]] || {
    echo '[ERROR] a starting Docker network ID disappeared' >&2
    return 1
  }
}

assert_run_resources_removed() {
  local residue=0
  [[ -z "$(docker ps -aq --filter "label=${RUN_LABEL}" 2>/dev/null)" ]] || residue=1
  [[ -z "$(docker volume ls -q --filter "label=${RUN_LABEL}" 2>/dev/null)" ]] || residue=1
  [[ -z "$(docker network ls -q --filter "label=${RUN_LABEL}" 2>/dev/null)" ]] || residue=1
  if ((residue)); then
    echo '[ERROR] labelled temporary Docker resources remain after cleanup' >&2
    docker ps -a --filter "label=${RUN_LABEL}" --format 'container={{.ID}} name={{.Names}}' >&2 || true
    docker volume ls --filter "label=${RUN_LABEL}" >&2 || true
    docker network ls --filter "label=${RUN_LABEL}" >&2 || true
    return 1
  fi
}

cleanup() {
  local status="${1:-0}" cleanup_status=0
  set +e
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1
  docker volume rm "$DB_VOLUME" >/dev/null 2>&1
  docker network rm "$NETWORK" >/dev/null 2>&1
  assert_starting_docker_ids_unchanged || cleanup_status=1
  if [[ "$WORK_DIR" == "${TMPDIR:-/tmp}/${RUN_ID}."* ]]; then
    find "$WORK_DIR" -depth -delete >/dev/null 2>&1
  else
    echo '[ERROR] refusing to delete an unexpected integration work directory' >&2
    cleanup_status=1
  fi
  assert_run_resources_removed || cleanup_status=1
  if [[ -d "$WORK_DIR" ]]; then
    echo '[ERROR] integration work directory remains after cleanup' >&2
    cleanup_status=1
  fi
  if ((cleanup_status == 0)); then
    echo '[google-drive-dr-integration] labelled temporary resources=0'
  fi
  trap - EXIT INT TERM
  if ((status == 0 && cleanup_status != 0)); then
    status=1
  fi
  exit "$status"
}

failure_diagnostics() {
  local exit_code="$1"
  echo "[ERROR] isolated Google Drive DR integration failed: stage=${STAGE} exit=${exit_code}" >&2
  docker ps -a --filter "name=^/${DB_CONTAINER}$" \
    --format 'name={{.Names}} status={{.Status}} ports={{.Ports}}' >&2 || true
  docker logs --timestamps --tail 120 "$DB_CONTAINER" >&2 || true
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  if ((exit_code != 0)); then
    failure_diagnostics "$exit_code"
  fi
  cleanup "$exit_code"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stage 'check Docker and record existing resource IDs'
docker info >/dev/null
capture_starting_docker_ids

stage 'prepare isolated Docker images and resources'
if ! docker image inspect pgvector/pgvector:pg15 >/dev/null 2>&1; then
  docker pull pgvector/pgvector:pg15 >/dev/null
fi
if command -v restic >/dev/null 2>&1; then
  RESTIC_MODE='host'
else
  RESTIC_MODE='docker'
  if ! docker image inspect "$RESTIC_IMAGE" >/dev/null 2>&1; then
    docker pull "$RESTIC_IMAGE" >/dev/null
  fi
fi

docker network create --label "$TEMP_LABEL" --label "$RUN_LABEL" "$NETWORK" >/dev/null
docker volume create --label "$TEMP_LABEL" --label "$RUN_LABEL" "$DB_VOLUME" >/dev/null
docker run -d \
  --name "$DB_CONTAINER" \
  --label "$TEMP_LABEL" \
  --label "$RUN_LABEL" \
  --network "$NETWORK" \
  --publish 127.0.0.1::5432 \
  --volume "$DB_VOLUME:/var/lib/postgresql/data" \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=borrow_return \
  pgvector/pgvector:pg15 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" pg_isready -U postgres -d borrow_return >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -U postgres -d borrow_return >/dev/null
published_port="$(docker port "$DB_CONTAINER" 5432/tcp | awk -F: 'END { print $NF }')"
[[ "$published_port" =~ ^[0-9]+$ ]] || {
  echo "[ERROR] failed to resolve loopback PostgreSQL port: ${published_port}" >&2
  exit 1
}
PORT="$published_port"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/borrow_return"

stage 'apply every Prisma migration to the isolated database'
migration_count="$(find "$ROOT/apps/api/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
"$PNPM" --dir "$ROOT/apps/api" exec prisma generate >/dev/null
DATABASE_URL="$DATABASE_URL" "$PNPM" --dir "$ROOT/apps/api" exec prisma migrate deploy >/dev/null
DATABASE_URL="$DATABASE_URL" "$PNPM" --dir "$ROOT/apps/api" exec prisma migrate status >/dev/null
applied_count="$(docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return -c \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
[[ "$applied_count" == "$migration_count" ]] || {
  echo "[ERROR] migration count mismatch: directories=${migration_count} applied=${applied_count}" >&2
  exit 1
}

stage 'insert representative SQL data and capture schema evidence'
docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d borrow_return <<'SQL'
INSERT INTO "ClientDevice" (id, name, "apiKey", "statusClientId", "updatedAt")
VALUES (
  'google-drive-dr-test-device',
  'google-drive-dr-test-device',
  'google-drive-dr-test-key',
  'google-drive-dr-test-client',
  NOW()
);
SQL
docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return -c \
  'SELECT count(*) FROM "ClientDevice" WHERE id = '\''google-drive-dr-test-device'\'';' \
  >"$WORK_DIR/initial-row-count.txt"
docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return -c \
  "SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1;" \
  >"$WORK_DIR/schema-initial.txt"
docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return -c \
  'SELECT migration_name, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM "_prisma_migrations" ORDER BY migration_name;' \
  >"$WORK_DIR/migrations-initial.txt"
docker exec "$DB_CONTAINER" psql -X -U postgres -d borrow_return -c \
  'EXPLAIN (ANALYZE, BUFFERS) SELECT "statusClientId" FROM "ClientDevice" WHERE "apiKey" = '\''google-drive-dr-test-key'\'';' \
  >"$WORK_DIR/explain-initial.txt"

stage 'create a PostgreSQL custom dump, Git bundle, manifest, and primary-file fixtures'
mkdir -p \
  "$PAYLOAD_DIR/db" \
  "$PAYLOAD_DIR/git" \
  "$PAYLOAD_DIR/primary/storage/photos" \
  "$PAYLOAD_DIR/primary/storage/pdfs"
docker exec "$DB_CONTAINER" pg_dump -U postgres -d borrow_return -Fc --no-owner --no-acl \
  >"$PAYLOAD_DIR/db/borrow_return.dump"
[[ -s "$PAYLOAD_DIR/db/borrow_return.dump" ]]
git_sha="$(git -C "$ROOT" rev-parse HEAD)"
git_dirty='false'
if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=all)" ]]; then
  git_dirty='true'
fi
git -C "$ROOT" bundle create "$PAYLOAD_DIR/git/repository.bundle" HEAD >/dev/null
git -C "$ROOT" bundle verify "$PAYLOAD_DIR/git/repository.bundle" >/dev/null
printf 'google-drive-dr primary photo fixture\n' >"$PAYLOAD_DIR/primary/storage/photos/photo-fixture.txt"
printf 'google-drive-dr primary PDF fixture\n' >"$PAYLOAD_DIR/primary/storage/pdfs/document-fixture.pdf"
photo_sha="$(sha256_file "$PAYLOAD_DIR/primary/storage/photos/photo-fixture.txt")"
document_sha="$(sha256_file "$PAYLOAD_DIR/primary/storage/pdfs/document-fixture.pdf")"
printf '{"schemaVersion":1,"repositorySha":"%s","worktreeDirty":%s,"primaryFileHashes":{"photo":"%s","document":"%s"}}\n' \
  "$git_sha" "$git_dirty" "$photo_sha" "$document_sha" >"$PAYLOAD_DIR/manifest.json"

stage 'create and verify an encrypted local restic snapshot'
mkdir -p "$RESTIC_REPO" "$RESTORE_DIR"
run_restic() {
  if [[ "$RESTIC_MODE" == 'host' ]]; then
    RESTIC_PASSWORD="$RESTIC_PASSWORD_VALUE" restic -r "$RESTIC_REPO" "$@"
  else
    local argument
    local -a docker_arguments=()
    for argument in "$@"; do
      if [[ "$argument" == "$WORK_DIR" || "$argument" == "$WORK_DIR/"* ]]; then
        docker_arguments+=("/work${argument#"$WORK_DIR"}")
      else
        docker_arguments+=("$argument")
      fi
    done
    docker run --rm \
      --label "$TEMP_LABEL" \
      --label "$RUN_LABEL" \
      --user "$(id -u):$(id -g)" \
      --env "RESTIC_PASSWORD=${RESTIC_PASSWORD_VALUE}" \
      --volume "$WORK_DIR:/work" \
      --workdir /work \
      "$RESTIC_IMAGE" \
      -r /work/restic-repository --no-cache "${docker_arguments[@]}"
  fi
}
run_restic init >/dev/null
run_restic backup --tag business-pi5-dr "$PAYLOAD_DIR" >/dev/null
run_restic check >/dev/null
snapshot_id="$(run_restic snapshots --json | python3 -c \
  'import json, sys; snapshots = json.load(sys.stdin); print(snapshots[-1]["short_id"])')"
[[ "$snapshot_id" =~ ^[0-9a-f]+$ ]] || {
  echo '[ERROR] restic did not return a snapshot ID' >&2
  exit 1
}

stage 'restore the latest snapshot into a new empty directory'
run_restic restore latest --tag business-pi5-dr --target "$RESTORE_DIR" >/dev/null
restored_manifest="$(find "$RESTORE_DIR" -type f -name manifest.json -print -quit)"
[[ -n "$restored_manifest" ]] || {
  echo '[ERROR] restored manifest was not found' >&2
  exit 1
}
restored_payload="$(dirname "$restored_manifest")"
python3 - "$restored_manifest" "$git_sha" "$git_dirty" <<'PY'
import json
import sys

manifest = json.loads(open(sys.argv[1], encoding='utf-8').read())
if manifest.get('repositorySha') != sys.argv[2]:
    raise SystemExit('restored manifest SHA mismatch')
if str(manifest.get('worktreeDirty')).lower() != sys.argv[3]:
    raise SystemExit('restored manifest dirty-state mismatch')
PY
restored_dump="$(find "$restored_payload" -type f -name borrow_return.dump -print -quit)"
restored_bundle="$(find "$restored_payload" -type f -name repository.bundle -print -quit)"
[[ -s "$restored_dump" && -s "$restored_bundle" ]]
git bundle verify "$restored_bundle" >/dev/null
docker exec -i "$DB_CONTAINER" pg_restore --list <"$restored_dump" >"$WORK_DIR/pg-restore-list.txt"
grep -q '_prisma_migrations' "$WORK_DIR/pg-restore-list.txt"

stage 'restore the dump into a fresh database and re-run Prisma migration deploy'
docker exec "$DB_CONTAINER" createdb -U postgres borrow_return_restored
docker exec -i "$DB_CONTAINER" pg_restore \
  -U postgres --exit-on-error --no-owner --dbname=borrow_return_restored <"$restored_dump"
RESTORED_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/borrow_return_restored"
DATABASE_URL="$RESTORED_DATABASE_URL" "$PNPM" --dir "$ROOT/apps/api" exec prisma migrate deploy >/dev/null
DATABASE_URL="$RESTORED_DATABASE_URL" "$PNPM" --dir "$ROOT/apps/api" exec prisma migrate status >/dev/null
docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return_restored -c \
  "SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1;" \
  >"$WORK_DIR/schema-restored.txt"
docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return_restored -c \
  'SELECT migration_name, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM "_prisma_migrations" ORDER BY migration_name;' \
  >"$WORK_DIR/migrations-restored.txt"
docker exec "$DB_CONTAINER" psql -XAt -U postgres -d borrow_return_restored -c \
  'SELECT count(*) FROM "ClientDevice" WHERE id = '\''google-drive-dr-test-device'\'';' \
  >"$WORK_DIR/restored-row-count.txt"
cmp -s "$WORK_DIR/schema-initial.txt" "$WORK_DIR/schema-restored.txt"
cmp -s "$WORK_DIR/migrations-initial.txt" "$WORK_DIR/migrations-restored.txt"
cmp -s "$WORK_DIR/initial-row-count.txt" "$WORK_DIR/restored-row-count.txt"
docker exec "$DB_CONTAINER" psql -X -U postgres -d borrow_return_restored -c \
  'EXPLAIN (ANALYZE, BUFFERS) SELECT "statusClientId" FROM "ClientDevice" WHERE "apiKey" = '\''google-drive-dr-test-key'\'';' \
  >"$WORK_DIR/explain-restored.txt"

stage 'compare restored primary-file hashes'
restored_photo="$(find "$restored_payload" -type f -name photo-fixture.txt -print -quit)"
restored_document="$(find "$restored_payload" -type f -name document-fixture.pdf -print -quit)"
[[ -n "$restored_photo" && -n "$restored_document" ]]
[[ "$(sha256_file "$restored_photo")" == "$photo_sha" ]]
[[ "$(sha256_file "$restored_document")" == "$document_sha" ]]
printf '[google-drive-dr-integration] PASS snapshot=%s migrations=%s rows=%s\n' \
  "$snapshot_id" "$migration_count" "$(tr -d '[:space:]' <"$WORK_DIR/initial-row-count.txt")"
