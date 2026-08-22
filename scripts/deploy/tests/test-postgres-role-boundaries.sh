#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PNPM="${ROOT}/scripts/ci/pnpm-exact.sh"
RUN_ID="postgres-role-contract-$(uuidgen | tr '[:upper:]' '[:lower:]')"
CONTAINER="${RUN_ID}-postgres"
VOLUME="${RUN_ID}-data"
NETWORK="${RUN_ID}-network"
PORT=""
MIGRATION_PASSWORD='contract-migration-password'
APP_PASSWORD='contract-application-password'

cleanup() {
  local failed=0
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker container inspect "$CONTAINER" >/dev/null 2>&1 && failed=1
  docker volume inspect "$VOLUME" >/dev/null 2>&1 && failed=1
  docker network inspect "$NETWORK" >/dev/null 2>&1 && failed=1
  if ((failed == 0)); then
    echo '[postgres-role-contract] cleanup verified: run resources=0'
  fi
  return "$failed"
}

on_exit() {
  local status=$?
  trap - EXIT
  cleanup || status=1
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker network create --label com.raspi-system.temporary=true "$NETWORK" >/dev/null
docker volume create --label com.raspi-system.temporary=true "$VOLUME" >/dev/null
docker run -d --name "$CONTAINER" --network "$NETWORK" \
  --label com.raspi-system.temporary=true \
  -p '127.0.0.1::5432' \
  -v "$VOLUME:/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=borrow_return \
  pgvector/pgvector:pg15 >/dev/null

published_port="$(docker port "$CONTAINER" 5432/tcp)"
[[ "$published_port" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || {
  echo "[ERROR] unexpected PostgreSQL binding: ${published_port}" >&2
  exit 1
}
PORT="${BASH_REMATCH[1]}"

for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres -d borrow_return >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d borrow_return >/dev/null

export PATH="${NODE20_BIN_DIR:-/opt/homebrew/Cellar/node@20/20.20.2/bin}:$PATH"
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/borrow_return"
"$PNPM" --dir "$ROOT/apps/api" exec prisma generate >/dev/null
"$PNPM" --dir "$ROOT/apps/api" exec prisma migrate deploy >/dev/null

# Preserve the existing production/CI invocation, which supplies only the two
# password variables and relies on the SQL's fixed borrow_return default.
docker exec -i "$CONTAINER" psql -X -q -v ON_ERROR_STOP=1 \
  -U postgres -d borrow_return \
  -v migration_password="$MIGRATION_PASSWORD" \
  -v app_password="$APP_PASSWORD" \
  -f - <"$ROOT/scripts/deploy/postgres-role-bootstrap.sql" >/dev/null

# Staging and parameterized environments use the validated renderer so their
# database identifier is explicit before psql receives any SQL.
APP_DATABASE_URL="postgresql://raspi_app:${APP_PASSWORD}@db:5432/borrow_return" \
MIGRATION_DATABASE_URL="postgresql://raspi_migrator:${MIGRATION_PASSWORD}@db:5432/borrow_return" \
  python3 "$ROOT/scripts/deploy/render-postgres-role-bootstrap.py" \
    "$ROOT/scripts/deploy/postgres-role-bootstrap.sql" \
  | docker exec -i "$CONTAINER" psql -X -q -v ON_ERROR_STOP=1 \
      -U postgres -d borrow_return >/dev/null

MIGRATION_DATABASE_URL="postgresql://raspi_migrator:${MIGRATION_PASSWORD}@127.0.0.1:${PORT}/borrow_return"
APP_DATABASE_URL="postgresql://raspi_app:${APP_PASSWORD}@127.0.0.1:${PORT}/borrow_return"

DATABASE_URL="$MIGRATION_DATABASE_URL" "$PNPM" --dir "$ROOT/apps/api" exec prisma migrate status >/dev/null

psql "$APP_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
INSERT INTO "ClientDevice" (id, name, "apiKey", "updatedAt")
VALUES ('role-contract-client', 'role-contract-client', 'client-key-role-contract', NOW());
UPDATE "ClientDevice" SET location = 'contract' WHERE id = 'role-contract-client';
DELETE FROM "ClientDevice" WHERE id = 'role-contract-client';
ROLLBACK;
SQL

docker exec -e PGPASSWORD="$APP_PASSWORD" "$CONTAINER" \
  pg_dump -h 127.0.0.1 -U raspi_app -d borrow_return \
  --format=plain --no-owner --no-privileges >/dev/null

if psql "$APP_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE role_contract_forbidden (id integer);' >/dev/null 2>&1; then
  echo '[ERROR] application role unexpectedly created a table' >&2
  exit 1
fi
if psql "$APP_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c 'DELETE FROM "_prisma_migrations";' >/dev/null 2>&1; then
  echo '[ERROR] application role unexpectedly changed migration metadata' >&2
  exit 1
fi
if psql "$APP_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c 'CREATE ROLE role_contract_forbidden;' >/dev/null 2>&1; then
  echo '[ERROR] application role unexpectedly created a role' >&2
  exit 1
fi

psql "$MIGRATION_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE role_contract_allowed (id integer); DROP TABLE role_contract_allowed;' >/dev/null

role_flags="$(docker exec "$CONTAINER" psql -U postgres -d borrow_return -Atqc \
  "SELECT rolname || '|' || rolsuper || '|' || rolcreatedb || '|' || rolcreaterole FROM pg_roles WHERE rolname IN ('raspi_app','raspi_migrator') ORDER BY rolname")"
expected_flags=$'raspi_app|false|false|false\nraspi_migrator|false|false|false'
[[ "$role_flags" == "$expected_flags" ]] || {
  echo "[ERROR] PostgreSQL role attributes violate the least-privilege contract: ${role_flags//$'\n'/,}" >&2
  exit 1
}

echo 'PASS: isolated PostgreSQL application/migration role boundaries'
