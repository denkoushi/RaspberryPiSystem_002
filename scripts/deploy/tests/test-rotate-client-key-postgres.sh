#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rotate-client-key-test.XXXXXX")"
RUN_ID="rotate-key-$(uuidgen | tr '[:upper:]' '[:lower:]')"
SCHEMA="rotation_$(printf '%s' "$RUN_ID" | tr -d '-')"
TEST_MODE="${ROTATE_CLIENT_KEY_TEST_DB_MODE:-compose}"
COUNT=0
export OLD_CLIENT_KEY='client-key-dummy-signage-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export NEW_CLIENT_KEY='client-key-dummy-signage-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
OLD="$OLD_CLIENT_KEY"
NEW="$NEW_CLIENT_KEY"
ID='00000000-0000-4000-8000-000000000001'

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$TEST_MODE" == compose ]]; then
    docker compose -f "$TEMP_DIR/compose.yml" down --volumes >/dev/null 2>&1 || status=1
  else
    printf 'DROP SCHEMA IF EXISTS %s CASCADE;\n' "$SCHEMA" | db >/dev/null 2>&1 || status=1
  fi
  rm -f "$TEMP_DIR/compose.yml"
  rmdir "$TEMP_DIR" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$TEST_MODE" in
  compose)
    cat > "$TEMP_DIR/compose.yml" <<YAML
name: $RUN_ID
services:
  db:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_PASSWORD: dummy-test-password
      POSTGRES_DB: borrow_return
    tmpfs:
      - /var/lib/postgresql/data
    command: [postgres, -c, log_statement=all, -c, log_duration=on, -c, log_min_duration_statement=0]
YAML
    docker compose -f "$TEMP_DIR/compose.yml" up -d >/dev/null
    for _ in $(seq 1 30); do
      docker compose -f "$TEMP_DIR/compose.yml" exec -T db pg_isready -U postgres >/dev/null 2>&1 && break
      sleep 1
    done
    docker compose -f "$TEMP_DIR/compose.yml" exec -T db pg_isready -U postgres >/dev/null
    DB=(docker compose -f "$TEMP_DIR/compose.yml" exec -T -e OLD_CLIENT_KEY -e NEW_CLIENT_KEY db psql -U postgres -d borrow_return)
    export ROTATE_CLIENT_KEY_DB_MODE=compose ROTATE_CLIENT_KEY_COMPOSE_FILE="$TEMP_DIR/compose.yml"
    ;;
  psql)
    # Caller supplies libpq PG* variables for a disposable local test database.
    DB=(psql)
    export ROTATE_CLIENT_KEY_DB_MODE=psql
    ;;
  *) echo 'FAIL: test DB mode must be compose or psql' >&2; exit 1 ;;
esac

db() {
  { printf "SET log_statement='none'; SET log_duration=off; SET log_min_duration_statement=-1;\n"; cat; } \
    | "${DB[@]}" -X -qAt -v ON_ERROR_STOP=1
}
if [[ "$TEST_MODE" == psql ]]; then
  printf 'CREATE SCHEMA %s;\n' "$SCHEMA" | db
  export PGOPTIONS="${PGOPTIONS:-} -c search_path=$SCHEMA,public"
fi

# Focused fixture: relevant PostgreSQL column types, uniqueness, identity/FK,
# settings and the three historical actorClientKey fields from Prisma schema.
db <<'SQL'
CREATE TABLE "ClientDevice" (id text PRIMARY KEY, name text NOT NULL, "apiKey" text NOT NULL UNIQUE,
  "signagePreviewTargetApiKey" text, "statusClientId" text, location text, "defaultMode" text);
CREATE TABLE "SignageSchedule" (id text PRIMARY KEY, "targetClientKeys" text[] NOT NULL DEFAULT '{}');
CREATE TABLE "Loan" (id text PRIMARY KEY, "clientId" text REFERENCES "ClientDevice"(id));
CREATE TABLE "ProductionScheduleOrderSplitAuditLog" (id text PRIMARY KEY, "actorClientKey" text);
CREATE TABLE "ProductionScheduleGlobalRankTemporaryOverride" (id text PRIMARY KEY, "actorClientKey" text);
CREATE TABLE "DueManagementProposalEvent" (id text PRIMARY KEY, "actorClientKey" text);
SQL

seed() {
  export OLD_CLIENT_KEY="$OLD" NEW_CLIENT_KEY="$NEW"
  db <<'SQL'
\getenv old OLD_CLIENT_KEY
\getenv new NEW_CLIENT_KEY
TRUNCATE "Loan", "ClientDevice", "SignageSchedule", "ProductionScheduleOrderSplitAuditLog",
  "ProductionScheduleGlobalRankTemporaryOverride", "DueManagementProposalEvent";
INSERT INTO "ClientDevice" VALUES
  ('00000000-0000-4000-8000-000000000001', 'dummy-target', :'old', :'old', 'dummy-status', 'dummy-location', 'PHOTO'),
  ('00000000-0000-4000-8000-000000000002', 'dummy-preview', 'dummy-other-key', :'old', NULL, NULL, 'TAG'),
  ('00000000-0000-4000-8000-000000000003', 'dummy-unrelated', 'dummy-unrelated-key', 'dummy-preview-key', NULL, NULL, 'TAG');
INSERT INTO "SignageSchedule" VALUES ('dummy-mixed', ARRAY[:'old', 'dummy-other-key', :'old', :'old' || '-suffix']),
  ('dummy-empty', '{}'), ('dummy-unrelated', ARRAY['dummy-other-key']);
INSERT INTO "Loan" VALUES ('dummy-loan', '00000000-0000-4000-8000-000000000001');
INSERT INTO "ProductionScheduleOrderSplitAuditLog" VALUES ('dummy-audit', :'old');
INSERT INTO "ProductionScheduleGlobalRankTemporaryOverride" VALUES ('dummy-audit', :'old');
INSERT INTO "DueManagementProposalEvent" VALUES ('dummy-audit', :'old');
SQL
}
snapshot() {
  db <<'SQL'
SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (
  SELECT row_to_json(d)::text AS t FROM "ClientDevice" d
  UNION ALL SELECT row_to_json(s)::text FROM "SignageSchedule" s
  UNION ALL SELECT row_to_json(l)::text FROM "Loan" l
  UNION ALL SELECT row_to_json(a)::text FROM "ProductionScheduleOrderSplitAuditLog" a
  UNION ALL SELECT row_to_json(a)::text FROM "ProductionScheduleGlobalRankTemporaryOverride" a
  UNION ALL SELECT row_to_json(a)::text FROM "DueManagementProposalEvent" a
) rows;
SQL
}
check() {
  [[ "$1" == "$2" ]] || { echo "FAIL: $3" >&2; exit 1; }
  COUNT=$((COUNT + 1))
  printf 'PASS: %s\n' "$3"
}
run_rotation() {
  local expected_status="$1"
  shift
  local status=0
  OUTPUT="$(bash "$ROOT/scripts/security/rotate-client-key.sh" "$@" 2>&1)" || status=$?
  if [[ "$expected_status" == success ]]; then
    check "$status" 0 'rotation succeeds'
  else
    [[ "$status" != 0 ]] || { echo 'FAIL: rotation unexpectedly succeeded' >&2; exit 1; }
    COUNT=$((COUNT + 1))
  fi
  [[ "$OUTPUT" != *"$OLD_CLIENT_KEY"* && "$OUTPUT" != *"$NEW_CLIENT_KEY"* ]] \
    || { echo 'FAIL: output contains a credential' >&2; exit 1; }
  COUNT=$((COUNT + 1))
}
reject() {
  local before
  local reason="$1" label="$2"
  shift 2
  before="$(snapshot)"
  run_rotation failure "$ID" "$@"
  [[ "$OUTPUT" == *"$reason"* ]] || { echo 'FAIL: incorrect validation reason' >&2; exit 1; }
  check "$(snapshot)" "$before" "$label leaves data unchanged"
}

seed
BEFORE="$(snapshot)"
run_rotation success --dry-run "$ID"
check "$(snapshot)" "$BEFORE" 'dry-run leaves all data unchanged'
check "$OUTPUT" 'SUCCESS apiKey=1 signagePreviewTargetApiKey=2 targetClientKeys=1 mode=dry-run (changed rows per field)' 'dry-run reports field row counts'
run_rotation success "$ID"
check "$OUTPUT" 'SUCCESS apiKey=1 signagePreviewTargetApiKey=2 targetClientKeys=1 mode=execute (changed rows per field)' 'execution reports field row counts'
VERIFIED="$(db <<'SQL'
\getenv old OLD_CLIENT_KEY
\getenv new NEW_CLIENT_KEY
SELECT (SELECT count(*) FROM "ClientDevice" WHERE "apiKey" = :'new') = 1
 AND EXISTS (SELECT 1 FROM "ClientDevice" WHERE id = '00000000-0000-4000-8000-000000000001'
   AND "apiKey" = :'new' AND "signagePreviewTargetApiKey" = :'new' AND "statusClientId" = 'dummy-status'
   AND location = 'dummy-location' AND "defaultMode" = 'PHOTO')
 AND EXISTS (SELECT 1 FROM "ClientDevice" WHERE name = 'dummy-preview' AND "signagePreviewTargetApiKey" = :'new')
 AND EXISTS (SELECT 1 FROM "ClientDevice" WHERE name = 'dummy-unrelated' AND "signagePreviewTargetApiKey" = 'dummy-preview-key')
 AND EXISTS (SELECT 1 FROM "SignageSchedule" WHERE id = 'dummy-mixed'
   AND "targetClientKeys" = ARRAY[:'new', 'dummy-other-key', :'new', :'old' || '-suffix'])
 AND EXISTS (SELECT 1 FROM "SignageSchedule" WHERE id = 'dummy-empty' AND "targetClientKeys" = '{}')
 AND EXISTS (SELECT 1 FROM "SignageSchedule" WHERE id = 'dummy-unrelated' AND "targetClientKeys" = ARRAY['dummy-other-key'])
 AND EXISTS (SELECT 1 FROM "Loan" WHERE "clientId" = '00000000-0000-4000-8000-000000000001')
 AND (SELECT "actorClientKey" = :'old' FROM "ProductionScheduleOrderSplitAuditLog")
 AND (SELECT "actorClientKey" = :'old' FROM "ProductionScheduleGlobalRankTemporaryOverride")
 AND (SELECT "actorClientKey" = :'old' FROM "DueManagementProposalEvent");
SQL
)"
check "$VERIFIED" t 'exact references, array order, identity, settings, loans and audit history are preserved'
reject 'old key does not match' 'repeat execution'
export OLD_CLIENT_KEY="$NEW" NEW_CLIENT_KEY="$OLD"
run_rotation success "$ID"
check "$(snapshot)" "$BEFORE" 'reverse execution restores all data'

seed
export OLD_CLIENT_KEY='dummy-mismatching-key'
reject 'old key does not match' 'old key mismatch'
seed
db <<'SQL'
\getenv new NEW_CLIENT_KEY
UPDATE "ClientDevice" SET "apiKey" = :'new' WHERE name = 'dummy-unrelated';
SQL
reject 'new key is already in use' 'duplicate new key'
seed
for invalid in 'dummy-invalid-format' 'client-key-dummy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'client-key-dummy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaag' "client-key-dummy-$(printf '%0260d' 0)"; do
  export NEW_CLIENT_KEY="$invalid"
  reject 'new key format is invalid' 'invalid format'
done
seed
export NEW_CLIENT_KEY='client-key-dummy-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
reject 'preserve signage identity' 'missing signage'
seed
export NEW_CLIENT_KEY="$OLD"
reject 'differ from old key' 'identical keys'
seed
run_rotation failure '00000000-0000-4000-8000-000000000099'
check "$OUTPUT" 'FAIL: target row does not exist mode=execute' 'missing target'

# Check arbitrary legacy values are handled as data through COPY.
OLD=$'dummy-legacy-\047-\\-\n-key'
seed
run_rotation success "$ID"

OLD=$'dummy-legacy-signage-\047-\\-\n-key'
seed
LEGACY_BEFORE="$(snapshot)"
run_rotation success "$ID"
export OLD_CLIENT_KEY="$NEW" NEW_CLIENT_KEY="$OLD"
reject 'new key format is invalid' 'legacy reverse without restore'
RESTORE_BEFORE="$(snapshot)"
run_rotation success --restore --dry-run "$ID"
check "$OUTPUT" 'SUCCESS apiKey=1 signagePreviewTargetApiKey=2 targetClientKeys=1 mode=restore-dry-run (changed rows per field)' 'restore dry-run reports mode'
check "$(snapshot)" "$RESTORE_BEFORE" 'restore dry-run leaves all data unchanged'
run_rotation success --restore "$ID"
check "$OUTPUT" 'SUCCESS apiKey=1 signagePreviewTargetApiKey=2 targetClientKeys=1 mode=restore (changed rows per field)' 'restore reports mode'
check "$(snapshot)" "$LEGACY_BEFORE" 'restore returns legacy key and all references'

OLD='dummy-legacy-signage-value'
seed
run_rotation success "$ID"
export OLD_CLIENT_KEY="$NEW" NEW_CLIENT_KEY="$OLD"
db <<'SQL'
\getenv new NEW_CLIENT_KEY
UPDATE "ClientDevice" SET "apiKey" = :'new' WHERE name = 'dummy-unrelated';
SQL
reject 'new key is already in use' 'restore duplicate key' --restore
export OLD_CLIENT_KEY='dummy-mismatching-signage-value'
reject 'old key does not match' 'restore old key mismatch' --restore
export OLD_CLIENT_KEY="$NEW" NEW_CLIENT_KEY='dummy-legacy-value'
reject 'preserve signage identity' 'restore missing signage' --restore

# A trigger represents an unexpected DB-side rewrite; final verification must
# reject it and roll back every field rather than reporting partial success.
OLD='client-key-dummy-SIGNAGE-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
seed
db <<'SQL'
CREATE FUNCTION dummy_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."targetClientKeys" := OLD."targetClientKeys"; RETURN NEW; END $$;
CREATE TRIGGER dummy_rewrite BEFORE UPDATE ON "SignageSchedule" FOR EACH ROW EXECUTE FUNCTION dummy_rewrite();
SQL
reject 'final verification failed' 'final verification'
db <<'SQL'
DROP TRIGGER dummy_rewrite ON "SignageSchedule";
DROP FUNCTION dummy_rewrite();
CREATE FUNCTION dummy_error() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'dummy failure: %', NEW."apiKey"; END $$;
CREATE TRIGGER dummy_error BEFORE UPDATE ON "ClientDevice" FOR EACH ROW EXECUTE FUNCTION dummy_error();
SQL
reject 'database operation failed' 'DB error'

if [[ "$TEST_MODE" == compose ]]; then
  LOGS="$(docker compose -f "$TEMP_DIR/compose.yml" logs --no-color db 2>&1)"
elif [[ -n "${ROTATE_CLIENT_KEY_TEST_LOG:-}" ]]; then
  LOGS="$(cat "$ROTATE_CLIENT_KEY_TEST_LOG")"
else
  echo 'FAIL: provide ROTATE_CLIENT_KEY_TEST_LOG to verify local PostgreSQL logs' >&2
  exit 1
fi
[[ "$LOGS" != *"$OLD"* && "$LOGS" != *"$NEW"* && "$LOGS" != *'client-key-dummy-signage-'* ]] \
  || { echo 'FAIL: PostgreSQL logs contain a credential' >&2; exit 1; }
COUNT=$((COUNT + 1))
printf 'PASS: client key rotation PostgreSQL checks=%s\n' "$COUNT"
