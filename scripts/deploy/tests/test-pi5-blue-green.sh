#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-blue-green.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() { grep -Fq "$2" <<<"$1" || fail "expected '$2' in output: $1"; }
state() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f: value=json.load(f)
for part in sys.argv[2].split('.'): value=value.get(part) if isinstance(value, dict) else None
print(value if value is not None else '')
PY
}

common=(
  PI5_PROJECT_DIR="$ROOT"
  PI5_PHASE3_COMPOSE="$ROOT/infrastructure/docker/docker-compose.phase3.yml"
  PI5_ENV_FILE="$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env"
  PI5_BLUE_GREEN_DRY_RUN=1
  PI5_BLUE_GREEN_HTTP_ONLY=1
  PI5_BLUE_GREEN_TEST_MEMORY_MB=2048
  PI5_BLUE_GREEN_TEST_DISK_GB=20
  PI5_BLUE_GREEN_TEST_LOAD_AVG=0.2
  PI5_BLUE_GREEN_MIN_MEMORY_MB=1536
  PI5_BLUE_GREEN_MIN_DISK_GB=10
  PI5_BLUE_GREEN_LOCK_FILE="$TMP/lock"
  PI5_BLUE_GREEN_CONFIG_DIR="$TMP/config"
  PI5_BLUE_GREEN_STABLE_SECONDS=1
)

STATE1="$TMP/state-one.json"
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" bootstrap --confirm-bootstrap --api-image registry/api:old --web-image registry/web:old)"
assert_contains "$out" "bootstrap completed"
[[ "$(state "$STATE1" activeSlot)" == blue ]] || fail "blue was not active after bootstrap"

out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" prepare --api-image registry/api:new --web-image registry/web:new)"
assert_contains "$out" "candidate prepared"
[[ "$(state "$STATE1" candidateSlot)" == green ]] || fail "green was not prepared"
[[ "$(state "$STATE1" activeSlot)" == blue ]] || fail "prepare changed active slot"

out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" switch)"
assert_contains "$out" "switch completed"
[[ "$(state "$STATE1" activeSlot)" == green ]] || fail "green was not activated"
grep -Fq "api-green:8080" "$TMP/config/Caddyfile" || fail "gateway did not point to green API"
grep -Fq "web-green:80" "$TMP/config/Caddyfile" || fail "gateway did not point to green Web"

out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" rollback --reason test-failure)"
assert_contains "$out" "rollback completed"
[[ "$(state "$STATE1" activeSlot)" == blue ]] || fail "rollback did not restore blue"
[[ "$(state "$STATE1" rollbackReason)" == test-failure ]] || fail "rollback reason was not recorded"

STATE2="$TMP/state-resource.json"
if env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE2" PI5_BLUE_GREEN_TEST_MEMORY_MB=512 "$SCRIPT" bootstrap --confirm-bootstrap --api-image registry/api:old --web-image registry/web:old >/dev/null 2>&1; then
  fail "resource guard accepted insufficient memory"
fi
[[ ! -f "$STATE2" ]] || fail "resource failure wrote active state"

LOCK="$TMP/held.lock"
if command -v flock >/dev/null 2>&1; then
  flock -n "$LOCK" sleep 2 &
  holder=$!
  sleep 0.1
  if env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" status >/dev/null 2>&1; then
    kill "$holder" 2>/dev/null || true
    fail "concurrent operation was accepted"
  fi
  wait "$holder" || true
else
  mkdir "${LOCK}.d"
  if env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" status >/dev/null 2>&1; then
    rmdir "${LOCK}.d"
    fail "concurrent operation was accepted"
  fi
  rmdir "${LOCK}.d"
fi

ENV_FILE="$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env"
PI5_BLUE_API_IMAGE=registry/api:blue PI5_GREEN_API_IMAGE=registry/api:green \
PI5_BLUE_WEB_IMAGE=registry/web:blue PI5_GREEN_WEB_IMAGE=registry/web:green \
PI5_GATEWAY_IMAGE=registry/web:green PI5_PROJECT_DIR="$ROOT" PI5_ENV_FILE="$ENV_FILE" \
docker compose -f "$ROOT/infrastructure/docker/docker-compose.phase3.yml" config --quiet

echo "PASS: pi5 blue/green deployment lifecycle"
