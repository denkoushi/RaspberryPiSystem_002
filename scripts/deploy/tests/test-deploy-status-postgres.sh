#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ID="rolling-deploy-status-$(uuidgen | tr '[:upper:]' '[:lower:]')"
CONTAINER="${ID}-postgres"
VOLUME="${ID}-data"
NETWORK="${ID}-network"
REQUESTED_PORT="${ROLLING_DEPLOY_TEST_POSTGRES_PORT:-}"
PORT=""
STAGE="initialization"

cleanup() {
  local cleanup_failed=0
  echo "[deploy-status-postgres] cleanup container=${CONTAINER}"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "[deploy-status-postgres] cleanup volume=${VOLUME}"
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  echo "[deploy-status-postgres] cleanup network=${NETWORK}"
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "[ERROR] temporary container remains after cleanup: ${CONTAINER}" >&2
    cleanup_failed=1
  fi
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    echo "[ERROR] temporary volume remains after cleanup: ${VOLUME}" >&2
    cleanup_failed=1
  fi
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "[ERROR] temporary network remains after cleanup: ${NETWORK}" >&2
    cleanup_failed=1
  fi
  if (( cleanup_failed == 0 )); then
    echo "[deploy-status-postgres] cleanup verified: run resources=0"
  fi
  return "$cleanup_failed"
}

failure_diagnostics() {
  local exit_code="$1"

  echo "[ERROR] isolated deploy-status PostgreSQL integration failed: stage=${STAGE} exit=${exit_code}" >&2
  echo "[ERROR] container state follows (test-only resource ${CONTAINER})" >&2
  docker ps -a --filter "name=^/${CONTAINER}$" \
    --format 'name={{.Names}} status={{.Status}} ports={{.Ports}}' >&2 || true
  docker inspect --format \
    'state={{.State.Status}} exitCode={{.State.ExitCode}} error={{printf "%q" .State.Error}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}unavailable{{end}}' \
    "$CONTAINER" >&2 || true
  echo "[ERROR] PostgreSQL container log tail follows" >&2
  docker logs --timestamps --tail 200 "$CONTAINER" >&2 || true
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  if (( exit_code != 0 )); then
    failure_diagnostics "$exit_code"
  fi
  if ! cleanup; then
    exit_code=1
  fi
  exit "$exit_code"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stage() {
  STAGE="$1"
  printf '[deploy-status-postgres] stage=%s\n' "$STAGE"
}

stage "select loopback test port"
if [[ -n "$REQUESTED_PORT" ]]; then
  if [[ ! "$REQUESTED_PORT" =~ ^[0-9]+$ ]] \
      || (( REQUESTED_PORT < 1 || REQUESTED_PORT > 65535 )); then
    echo "ROLLING_DEPLOY_TEST_POSTGRES_PORT must be an integer from 1 to 65535" >&2
    exit 2
  fi
  PORT="$REQUESTED_PORT"
  if docker ps --format '{{.Ports}}' | grep -Eq "(:|->)${PORT}(:|->)"; then
    echo "Test port ${PORT} is in use; choose another ROLLING_DEPLOY_TEST_POSTGRES_PORT" >&2
    exit 2
  fi
fi

stage "create isolated Docker resources"
docker network create --label com.raspi-system.temporary=true "$NETWORK" >/dev/null
docker volume create --label com.raspi-system.temporary=true "$VOLUME" >/dev/null

stage "start PostgreSQL container"
docker run -d --name "$CONTAINER" --network "$NETWORK" -v "$VOLUME:/var/lib/postgresql/data" \
  --label com.raspi-system.temporary=true \
  -p "127.0.0.1:${PORT}:5432" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=borrow_return \
  --health-cmd='pg_isready -U postgres' --health-interval=2s --health-timeout=2s --health-retries=30 \
  pgvector/pgvector:pg15 >/dev/null

if [[ -z "$PORT" ]]; then
  published_port="$(docker port "$CONTAINER" 5432/tcp)"
  if [[ ! "$published_port" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
    echo "[ERROR] Docker did not publish PostgreSQL on one loopback port: ${published_port}" >&2
    exit 1
  fi
  PORT="${BASH_REMATCH[1]}"
fi

stage "wait for PostgreSQL readiness"
postgres_ready=0
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    postgres_ready=1
    break
  fi
  sleep 1
done
if (( postgres_ready == 0 )); then
  echo "[ERROR] PostgreSQL did not become ready within 30 seconds" >&2
  docker exec "$CONTAINER" pg_isready -U postgres >&2 || true
  exit 1
fi

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/borrow_return"
export JWT_ACCESS_SECRET='test-access-secret-1234567890'
export JWT_REFRESH_SECRET='test-refresh-secret-1234567890'

stage "build shared packages"
pnpm --dir "$ROOT" --filter @raspi-system/shared-types build
pnpm --dir "$ROOT" --filter @raspi-system/part-search-core build
pnpm --dir "$ROOT" --filter @raspi-system/shelf-layout-core build

stage "generate Prisma client"
pnpm --dir "$ROOT/apps/api" exec prisma generate

stage "apply and verify migrations"
pnpm --dir "$ROOT/apps/api" exec prisma migrate deploy
pnpm --dir "$ROOT/apps/api" exec prisma migrate status
migration_anomalies="$(
  docker exec "$CONTAINER" psql -U postgres -d borrow_return -Atqc \
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;'
)"
if [[ "$migration_anomalies" != "0" ]]; then
  echo "[ERROR] incomplete or rolled-back Prisma migrations: ${migration_anomalies}" >&2
  exit 1
fi

stage "seed deploy-status fixture and inspect index"
docker exec -i "$CONTAINER" psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "ClientDevice" (id, name, "apiKey", "statusClientId", "updatedAt")
VALUES ('rolling-test-device', 'rolling-test-device', 'client-key-raspberrypi4-kiosk1', 'raspberrypi4-kiosk1', NOW());
EXPLAIN (ANALYZE, BUFFERS) SELECT "statusClientId" FROM "ClientDevice"
WHERE "apiKey" = 'client-key-raspberrypi4-kiosk1';
SQL

stage "run deploy-status API tests"
pnpm --dir "$ROOT/apps/api" test -- src/routes/system/__tests__/deploy-status-normalize.test.ts src/routes/system/__tests__/deploy-status.test.ts
echo 'PASS: isolated deploy-status PostgreSQL integration'
