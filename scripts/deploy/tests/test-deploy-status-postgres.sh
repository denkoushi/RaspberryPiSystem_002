#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ID="rolling-deploy-status-$(uuidgen | tr '[:upper:]' '[:lower:]')"
CONTAINER="${ID}-postgres"
VOLUME="${ID}-data"
NETWORK="${ID}-network"
PORT="${ROLLING_DEPLOY_TEST_POSTGRES_PORT:-55439}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if docker ps --format '{{.Ports}}' | grep -Eq "(:|->)${PORT}(:|->)"; then
  echo "Test port ${PORT} is in use; set ROLLING_DEPLOY_TEST_POSTGRES_PORT" >&2
  exit 2
fi

docker network create --label com.raspi-system.temporary=true "$NETWORK" >/dev/null
docker volume create --label com.raspi-system.temporary=true "$VOLUME" >/dev/null
docker run -d --name "$CONTAINER" --network "$NETWORK" -v "$VOLUME:/var/lib/postgresql/data" \
  -p "127.0.0.1:${PORT}:5432" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=borrow_return \
  --health-cmd='pg_isready -U postgres' --health-interval=2s --health-timeout=2s --health-retries=30 \
  pgvector/pgvector:pg15 >/dev/null

for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/borrow_return"
export JWT_ACCESS_SECRET='test-access-secret-1234567890'
export JWT_REFRESH_SECRET='test-refresh-secret-1234567890'

pnpm --dir "$ROOT" --filter @raspi-system/shared-types build
pnpm --dir "$ROOT/apps/api" exec prisma generate
pnpm --dir "$ROOT/apps/api" exec prisma migrate deploy
pnpm --dir "$ROOT/apps/api" exec prisma migrate status
docker exec -i "$CONTAINER" psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "ClientDevice" (id, name, "apiKey", "statusClientId", "updatedAt")
VALUES ('rolling-test-device', 'rolling-test-device', 'client-key-raspberrypi4-kiosk1', 'raspberrypi4-kiosk1', NOW());
EXPLAIN (ANALYZE, BUFFERS) SELECT "statusClientId" FROM "ClientDevice"
WHERE "apiKey" = 'client-key-raspberrypi4-kiosk1';
SQL
pnpm --dir "$ROOT/apps/api" test -- src/routes/system/__tests__/deploy-status-normalize.test.ts src/routes/system/__tests__/deploy-status.test.ts
echo 'PASS: isolated deploy-status PostgreSQL integration'
