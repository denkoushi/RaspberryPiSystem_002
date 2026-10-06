#!/usr/bin/env bash
# Rotate one existing ClientDevice credential and its live signage references.
# Requires PostgreSQL 14+ and an administrative DB role (session log controls).
# Usage: OLD_CLIENT_KEY / NEW_CLIENT_KEY in the environment, then:
#   bash scripts/security/rotate-client-key.sh <ClientDevice UUID> [--restore] [--dry-run]
# New keys: client-key-, optional alphanumeric/hyphen/underscore label, and
# at least 32 trailing hex digits; maximum 255 ASCII characters.
# DB mode: ROTATE_CLIENT_KEY_DB_MODE=compose (default) or psql (libpq PG* env).
# Compose: ROTATE_CLIENT_KEY_COMPOSE_FILE, ROTATE_CLIENT_KEY_DB_USER / DB_NAME.
# Run on Pi5 before the separate standard deployment of that one terminal.
# Reverse by swapping the values and using --restore for a legacy key.
# Restore skips only the new key format check; the 255-character limit remains.
set +x
set +v
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE=execute
RESTORE=false
DRY_RUN=false
DEVICE_ID=""
fail() { printf 'FAIL: %s mode=%s\n' "$1" "$MODE" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --restore) RESTORE=true ;;
    *)
      [[ -z "$DEVICE_ID" && "$arg" != -* ]] || fail 'expected one UUID and optional --restore / --dry-run'
      DEVICE_ID="$arg"
      ;;
  esac
done
if [[ "$RESTORE" == true ]]; then
  MODE=restore
fi
if [[ "$DRY_RUN" == true ]]; then
  if [[ "$RESTORE" == true ]]; then MODE=restore-dry-run; else MODE=dry-run; fi
fi
[[ "$DEVICE_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] \
  || fail 'ClientDevice.id must be a UUID'
[[ -n "${OLD_CLIENT_KEY:-}" && -n "${NEW_CLIENT_KEY:-}" ]] || fail 'both key environment variables are required'
[[ "$OLD_CLIENT_KEY" != "$NEW_CLIENT_KEY" ]] || fail 'new key must differ from old key'
[[ ${#NEW_CLIENT_KEY} -le 255 ]] || fail 'new key format is invalid'
[[ "$RESTORE" == true || "$NEW_CLIENT_KEY" =~ ^client-key-([a-zA-Z0-9_-]+-)?[a-fA-F0-9]{32,}$ ]] \
  || fail 'new key format is invalid'
old_lower="$(printf '%s' "$OLD_CLIENT_KEY" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
new_lower="$(printf '%s' "$NEW_CLIENT_KEY" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
[[ "$old_lower" != *signage* || "$new_lower" == *signage* ]] || fail 'new key must preserve signage identity'

case "${ROTATE_CLIENT_KEY_DB_MODE:-compose}" in
  compose)
    DB=(docker compose --project-directory "$ROOT" -f "${ROTATE_CLIENT_KEY_COMPOSE_FILE:-$ROOT/infrastructure/docker/docker-compose.server.yml}"
      exec -T db psql -U "${ROTATE_CLIENT_KEY_DB_USER:-postgres}" -d "${ROTATE_CLIENT_KEY_DB_NAME:-borrow_return}")
    ;;
  psql) DB=(psql) ;;
  *) fail 'DB mode must be compose or psql' ;;
esac

rotation_sql() {
  cat <<'SQL'
\set ECHO none
BEGIN;
-- Fail before receiving credentials if session log controls are unavailable.
SET LOCAL log_statement = 'none';
SET LOCAL log_duration = off;
SET LOCAL log_min_duration_statement = -1;
SET LOCAL log_min_duration_sample = -1;
SET LOCAL log_min_messages = 'panic';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE rotation_input (id text, old_key text, new_key text) ON COMMIT DROP;
COPY rotation_input FROM STDIN;
SQL
  # Hex COPY data keeps arbitrary old values out of SQL and psql meta-commands.
  printf '%s\t' "$DEVICE_ID"
  printf '%s' "$OLD_CLIENT_KEY" | od -An -v -tx1 | tr -d ' \n'
  printf '\t'
  printf '%s' "$NEW_CLIENT_KEY" | od -An -v -tx1 | tr -d ' \n'
  printf '\n\\.\n'
  cat <<'SQL'
UPDATE rotation_input SET old_key = convert_from(decode(old_key, 'hex'), 'UTF8'),
  new_key = convert_from(decode(new_key, 'hex'), 'UTF8');
-- Serialize writes through validation and final checks, including dry runs.
LOCK TABLE "ClientDevice", "SignageSchedule" IN SHARE ROW EXCLUSIVE MODE;
SELECT EXISTS (SELECT 1 FROM "ClientDevice" d, rotation_input r WHERE d.id = r.id) AS present \gset
\if :present
\else
\echo FAIL: target row does not exist
ROLLBACK;
\quit
\endif
SELECT EXISTS (SELECT 1 FROM "ClientDevice" d, rotation_input r
  WHERE d.id = r.id AND d."apiKey" = r.old_key) AS matches \gset
\if :matches
\else
\echo FAIL: old key does not match
ROLLBACK;
\quit
\endif
SELECT NOT EXISTS (SELECT 1 FROM "ClientDevice" d, rotation_input r
  WHERE d."apiKey" = r.new_key) AS available \gset
\if :available
\else
\echo FAIL: new key is already in use
ROLLBACK;
\quit
\endif
WITH changed AS (
  UPDATE "ClientDevice" d SET "apiKey" = r.new_key
  FROM rotation_input r WHERE d.id = r.id RETURNING d.id
) SELECT count(*) AS api_count FROM changed \gset
WITH changed AS (
  UPDATE "ClientDevice" d SET "signagePreviewTargetApiKey" = r.new_key
  FROM rotation_input r WHERE d."signagePreviewTargetApiKey" = r.old_key RETURNING d.id
) SELECT count(*) AS preview_count FROM changed \gset
WITH changed AS (
  UPDATE "SignageSchedule" s SET "targetClientKeys" = array_replace(s."targetClientKeys", r.old_key, r.new_key)
  FROM rotation_input r WHERE r.old_key = ANY(s."targetClientKeys") RETURNING s.id
) SELECT count(*) AS schedule_count FROM changed \gset
SELECT
  NOT EXISTS (SELECT 1 FROM "ClientDevice" d, rotation_input r
    WHERE d."apiKey" = r.old_key OR d."signagePreviewTargetApiKey" = r.old_key)
  AND NOT EXISTS (SELECT 1 FROM "SignageSchedule" s, rotation_input r WHERE r.old_key = ANY(s."targetClientKeys"))
  AND (SELECT count(*) FROM "ClientDevice" d, rotation_input r WHERE d."apiKey" = r.new_key) = 1
  AND EXISTS (SELECT 1 FROM "ClientDevice" d, rotation_input r WHERE d.id = r.id AND d."apiKey" = r.new_key)
  AS verified \gset
\if :verified
\else
\echo FAIL: final verification failed
ROLLBACK;
\quit
\endif
SQL
  if [[ "$DRY_RUN" == true ]]; then
    printf 'ROLLBACK;\n'
  else
    printf 'COMMIT;\n'
  fi
  printf '\\echo SUCCESS apiKey=:api_count signagePreviewTargetApiKey=:preview_count targetClientKeys=:schedule_count\n'
}

# Never forward raw DB/Compose diagnostics; constraint details may contain keys.
if ! result="$(rotation_sql 2>/dev/null | "${DB[@]}" -X -qAt -v ON_ERROR_STOP=1 -v ECHO=none -v ECHO_HIDDEN=off 2>/dev/null)"; then
  fail 'database operation failed; commit status unavailable'
fi
case "$result" in
  'FAIL: target row does not exist'|'FAIL: old key does not match'|'FAIL: new key is already in use'|'FAIL: final verification failed')
    printf '%s mode=%s\n' "$result" "$MODE" >&2
    exit 1
    ;;
  *)
    [[ "$result" =~ ^SUCCESS\ apiKey=[0-9]+\ signagePreviewTargetApiKey=[0-9]+\ targetClientKeys=[0-9]+$ ]] \
      || fail 'database operation did not report success'
    printf '%s mode=%s (changed rows per field)\n' "$result" "$MODE"
    ;;
esac
