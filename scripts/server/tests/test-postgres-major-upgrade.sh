#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUN_ID="pg-upgrade-test-$(uuidgen | tr '[:upper:]' '[:lower:]')"
TEST_DIR=$(mktemp -d)
OLD_VOLUME="${RUN_ID}-pg15"
NEW_VOLUME="${OLD_VOLUME}-pg18"
EMPTY_VOLUME="${RUN_ID}-empty"
GUARD_CONTAINER="${RUN_ID}-guard"
STARTED=$SECONDS
cleanup() {
  local status=$?
  trap - EXIT
  docker rm -f "$GUARD_CONTAINER" >/dev/null 2>&1 || true
  docker compose --project-directory "$TEST_DIR" --env-file "$TEST_DIR/test.env" -f "$TEST_DIR/compose.yml" down --volumes >/dev/null 2>&1 || status=1
  for volume in "$OLD_VOLUME" "$NEW_VOLUME" "$EMPTY_VOLUME"; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      docker volume rm "$volume" >/dev/null || status=1
    fi
    docker volume inspect "$volume" >/dev/null 2>&1 && status=1
  done
  echo "[postgres-major-upgrade] result=$status total=$((SECONDS-STARTED))s artifacts=$TEST_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'isolated-postgres-test-password\n' > "$TEST_DIR/password"
# .envや本番設定を一切読まない。
: > "$TEST_DIR/test.env"
write_compose() {
  local version=$1
  cat > "$TEST_DIR/compose.yml" <<YAML
name: $RUN_ID
services:
  db:
    image: pgvector/pgvector:pg$version
    environment:
      POSTGRES_DB: borrow_return
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres-superuser-password
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U postgres -d borrow_return']
      interval: 1s
      timeout: 3s
      retries: 60
    volumes:
      - type: bind
        source: $TEST_DIR/password
        target: /run/secrets/postgres-superuser-password
        read_only: true
YAML
  if [[ "$version" == 15 ]]; then
    cat >> "$TEST_DIR/compose.yml" <<'YAML'
      - db-data:/var/lib/postgresql/data
YAML
  else
    cat >> "$TEST_DIR/compose.yml" <<YAML
      - db-data-pg18:/var/lib/postgresql
      - db-data:/mnt/legacy-pgdata:ro
      - $ROOT/infrastructure/docker/postgres/db-start-guard.sh:/usr/local/bin/db-start-guard.sh:ro
    entrypoint: [/usr/local/bin/db-start-guard.sh]
    command: [postgres]
YAML
  fi
  cat >> "$TEST_DIR/compose.yml" <<YAML
volumes:
  db-data:
    name: $OLD_VOLUME
  db-data-pg18:
    name: $NEW_VOLUME
YAML
}
write_compose 15
compose=(docker compose --project-directory "$TEST_DIR" --env-file "$TEST_DIR/test.env" -f "$TEST_DIR/compose.yml")
upgrade=("$ROOT/scripts/server/postgres-major-upgrade.sh")
options=(--project-dir "$TEST_DIR" --compose-file "$TEST_DIR/compose.yml" --env-file "$TEST_DIR/test.env" --work-dir "$TEST_DIR/work")
"${compose[@]}" up -d --wait db
container=$("${compose[@]}" ps -q db)
# 初期化用の一時サーバーがhealthyになる場合もあるため完了ログを待つ。
for ((i=0; i<60; i++)); do
  if docker logs "$container" 2>&1 | grep -q 'PostgreSQL init process complete' &&
     docker exec "$container" pg_isready -U postgres -d borrow_return >/dev/null; then break; fi
  sleep 1
done
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d borrow_return <<'SQL'
CREATE EXTENSION vector;
CREATE EXTENSION pg_trgm;
CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY);
CREATE TABLE samples (id bigserial PRIMARY KEY, label text, embedding vector(3));
CREATE INDEX samples_trgm ON samples USING gin (label gin_trgm_ops);
INSERT INTO samples(label,embedding) VALUES ('日本語検索','[1,2,3]'),('second','[3,2,1]');
SELECT setval('samples_id_seq',42,true);
CREATE ROLE sample_group;
SQL
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d borrow_return \
  -v migration_password=migration-test -v app_password=app-test \
  -f - < "$ROOT/scripts/deploy/postgres-role-bootstrap.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d borrow_return \
  -c 'GRANT sample_group TO raspi_app WITH ADMIN OPTION;'
"${upgrade[@]}" preflight "${options[@]}"
# 接続中は拒否する（sleepの終了はDocker側で待つ）。
docker exec -d "$container" psql -U postgres -d borrow_return -c 'SELECT pg_sleep(5)'
for ((i=0; i<20; i++)); do
  active=$(docker exec "$container" psql -U postgres -d borrow_return -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(5)'")
  [[ "$active" == 1 ]] && break
  sleep 0.1
done
if "${upgrade[@]}" preflight "${options[@]}" > "$TEST_DIR/busy.log" 2>&1; then
  echo 'ERROR: preflight accepted an active client' >&2; exit 1
fi
grep -q 'DB clients remain' "$TEST_DIR/busy.log"
while [[ $(docker exec "$container" psql -U postgres -d borrow_return -Atqc "SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(5)'") != 0 ]]; do sleep 1; done
stage=$SECONDS
"${upgrade[@]}" migrate "${options[@]}"
echo "[postgres-major-upgrade] migrate=$((SECONDS-stage))s"
# 同じ移行先への再実行は拒否し、復元済みデータを保護する。
if "${upgrade[@]}" preflight "${options[@]}" > "$TEST_DIR/nonempty.log" 2>&1; then
  echo 'ERROR: preflight accepted nonempty target' >&2; exit 1
fi
grep -q 'Target volume is not empty' "$TEST_DIR/nonempty.log"
"${compose[@]}" stop db
write_compose 18
stage=$SECONDS
"${upgrade[@]}" activate --expect-major 18 "${options[@]}"
echo "[postgres-major-upgrade] activate18=$((SECONDS-stage))s"
container=$("${compose[@]}" ps -q db)
# TCP認証・権限を確認し、report比較後も書込みを残さない。
docker exec -i -e PGPASSWORD=app-test "$container" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U raspi_app -d borrow_return <<'SQL'
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM samples) <> 2 OR (SELECT last_value FROM samples_id_seq) <> 42 THEN
    RAISE EXCEPTION 'restored data/sequence mismatch';
  END IF;
  IF (SELECT embedding <-> '[1,2,3]'::vector FROM samples WHERE id=1) <> 0 THEN
    RAISE EXCEPTION 'vector query failed';
  END IF;
END $$;
UPDATE samples SET label='changed' WHERE id=1;
INSERT INTO samples(id,label,embedding) VALUES (99,'insert','[0,0,0]');
DELETE FROM samples WHERE id=99;
ROLLBACK;
SQL
if docker exec -e PGPASSWORD=app-test "$container" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U raspi_app -d borrow_return -c 'CREATE TABLE forbidden(id int)' > "$TEST_DIR/app-denied.log" 2>&1; then
  echo 'ERROR: raspi_app unexpectedly has DDL privileges' >&2; exit 1
fi
docker exec -i -e PGPASSWORD=migration-test "$container" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U raspi_migrator -d borrow_return <<'SQL'
BEGIN;
CREATE TABLE default_acl_check(id int);
DO $$ BEGIN
  IF NOT has_table_privilege('raspi_app','default_acl_check','INSERT') THEN
    RAISE EXCEPTION 'default privileges missing';
  END IF;
END $$;
ROLLBACK;
SQL
docker volume create "$EMPTY_VOLUME" >/dev/null
if docker run --name "$GUARD_CONTAINER" --network none \
  -v "$EMPTY_VOLUME:/var/lib/postgresql" -v "$OLD_VOLUME:/mnt/legacy-pgdata:ro" \
  -v "$ROOT/infrastructure/docker/postgres/db-start-guard.sh:/usr/local/bin/db-start-guard.sh:ro" \
  --entrypoint /usr/local/bin/db-start-guard.sh pgvector/pgvector:pg18 postgres > "$TEST_DIR/guard.log" 2>&1; then
  echo 'ERROR: guard accepted empty new data with legacy data' >&2; exit 1
fi
grep -q 'docs/runbooks/postgres-15-to-18-upgrade.md' "$TEST_DIR/guard.log"
"${compose[@]}" stop db
write_compose 15
stage=$SECONDS
"${upgrade[@]}" activate --expect-major 15 "${options[@]}"
echo "[postgres-major-upgrade] rollback15=$((SECONDS-stage))s"
echo 'PASS: PostgreSQL 15 -> 18 migration, guard, roles/ACL/data and rollback'
