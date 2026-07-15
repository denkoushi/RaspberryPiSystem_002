#!/usr/bin/env bash
# Validate the complete applied Prisma ledger and seal a run-scoped plan.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/migration-gate.sh
source "${SCRIPT_DIR}/lib/migration-gate.sh"

PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
BASE_COMPOSE="${PI5_BASE_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
PHASE3_COMPOSE="${PI5_PHASE3_COMPOSE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.yml}"
ENV_FILE="${PI5_ENV_FILE:-${PROJECT_DIR}/infrastructure/docker/.env}"
BLUE_GREEN_STATE="${PI5_BLUE_GREEN_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json}"
EVIDENCE_HELPER="${SCRIPT_DIR}/pi5-release-evidence.py"
REF=""
RUN_ID=""
OUTPUT=""

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
safe_git() {
  env -i HOME=/nonexistent \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C LC_ALL=C GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    /usr/bin/git -c core.fsmonitor=false -c core.ignorestat=false \
      -c core.trustctime=true -c extensions.worktreeConfig=false \
      -C "$PROJECT_DIR" "$@"
}
usage() {
  cat >&2 <<'EOF'
Usage: pi5-migration-plan.sh --ref FULL_SHA --run-id RUN_ID --output FILE

Reads the completed, non-rolled-back Prisma ledger from the active API,
validates the entire candidate ledger and Expand-only additions, then writes a
sealed plan. It never applies or rolls back a database migration.
EOF
}

while (($#)); do
  case "$1" in
    --ref) [[ $# -ge 2 ]] || die '--ref requires a value'; REF="$2"; shift 2 ;;
    --run-id) [[ $# -ge 2 ]] || die '--run-id requires a value'; RUN_ID="$2"; shift 2 ;;
    --output) [[ $# -ge 2 ]] || die '--output requires a value'; OUTPUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [[ "${ROLLING_RELEASE_PROTOCOL:-}" == 2 && ( -n "${PI5_MIGRATION_PLAN_TEST_MODE:-}" \
  || -n "${PI5_MIGRATION_BASE_REF:-}" || -n "${PI5_MIGRATION_LEDGER_FILE:-}" ) ]]; then
  die 'migration test overrides are forbidden under the production rolling-release protocol'
fi

[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || die '--ref must be a full lowercase Git SHA'
[[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] || die '--run-id is malformed'
[[ -n "$OUTPUT" ]] || die '--output is required'
safe_git cat-file -e "${REF}^{commit}" 2>/dev/null || die "candidate commit is unavailable: $REF"

active_slot() {
  python3 - "$BLUE_GREEN_STATE" <<'PY'
import json, sys
try:
    value=json.load(open(sys.argv[1], encoding='utf-8')).get('activeSlot')
except Exception as error:
    raise SystemExit(f'malformed Blue/Green state: {error}')
if value not in {'blue','green'}:
    raise SystemExit('Blue/Green state has no valid active slot')
print(value)
PY
}

active_container() {
  local slot
  if [[ -f "$BLUE_GREEN_STATE" ]]; then
    slot="$(active_slot)" || die 'existing Blue/Green state is malformed'
    docker ps -q \
      --filter "label=com.docker.compose.project=${PI5_BLUE_GREEN_COMPOSE_PROJECT:-bluegreen}" \
      --filter "label=com.docker.compose.service=api-${slot}"
  else
    docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" ps -q api 2>/dev/null
  fi
}

image_commit() {
  python3 - "$1" <<'PY'
import re, sys
matches=re.findall(r'(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])', sys.argv[1].lower())
if len(matches) != 1: raise SystemExit(1)
print(matches[0])
PY
}

BASE_REF="${PI5_MIGRATION_BASE_REF:-}"
CONTAINER_ID=""
if [[ -n "$BASE_REF" && "${PI5_MIGRATION_PLAN_TEST_MODE:-0}" != 1 ]]; then
  die 'migration base override is test-only; production base is bound to the active image'
fi
if [[ -z "$BASE_REF" ]]; then
  CONTAINER_ID="$(active_container)"
  [[ -n "$CONTAINER_ID" ]] || die 'active API container is unavailable'
  ACTIVE_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_ID")"
  BASE_REF="$(image_commit "$ACTIVE_IMAGE")" || die 'active API image does not contain one immutable commit SHA'
fi
[[ "$BASE_REF" =~ ^[0-9a-f]{40}$ ]] || die 'migration base commit is unknown'
safe_git cat-file -e "${BASE_REF}^{commit}" 2>/dev/null || die "migration base commit is unavailable: $BASE_REF"

LEDGER="$(mktemp "${TMPDIR:-/tmp}/pi5-migration-plan.XXXXXX")"
trap 'rm -f "$LEDGER"' EXIT
chmod 600 "$LEDGER"
if [[ -n "${PI5_MIGRATION_LEDGER_FILE:-}" ]]; then
  [[ "${PI5_MIGRATION_PLAN_TEST_MODE:-0}" == 1 ]] || die 'ledger file override is test-only'
  [[ -f "$PI5_MIGRATION_LEDGER_FILE" && ! -L "$PI5_MIGRATION_LEDGER_FILE" ]] || die 'test ledger is not a regular file'
  cp "$PI5_MIGRATION_LEDGER_FILE" "$LEDGER"
else
  [[ -n "$CONTAINER_ID" ]] || CONTAINER_ID="$(active_container)"
  [[ -n "$CONTAINER_ID" ]] || die 'active API container is unavailable'
  docker exec "$CONTAINER_ID" sh -lc \
    'PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -AtF "|" -c "SELECT migration_name, checksum FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"' \
    >"$LEDGER" || die 'could not read applied Prisma migration checksums'
fi

migration_gate_validate_ledger "$PROJECT_DIR" "$BASE_REF" "$REF" "$LEDGER" \
  || die 'migration ledger or SQL is outside the Expand-only contract'
python3 "$EVIDENCE_HELPER" create-migration \
  --output "$OUTPUT" --run-id "$RUN_ID" --sha "$REF" --base-sha "$BASE_REF" --ledger "$LEDGER"
printf 'migration plan verified: base=%s candidate=%s\n' "$BASE_REF" "$REF"
