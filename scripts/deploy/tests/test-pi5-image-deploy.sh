#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-image-deploy.sh"
TMP="$(mktemp -d)"
LOCK_HOLDER_PID=""
cleanup() {
  if [[ -n "$LOCK_HOLDER_PID" ]]; then
    kill "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
    wait "$LOCK_HOLDER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() { grep -Fq "$2" <<<"$1" || fail "expected '$2' in output: $1"; }

common_env=(
  PI5_PROJECT_DIR="$ROOT"
  PI5_BASE_COMPOSE="$ROOT/infrastructure/docker/docker-compose.server.yml"
  PI5_PHASE2_COMPOSE="$ROOT/infrastructure/docker/docker-compose.phase2.yml"
  PI5_ENV_FILE="$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env"
  PI5_DEPLOY_STATE_FILE="$TMP/state.json"
  PI5_DEPLOY_LOCK_FILE="$TMP/lock"
  PI5_DEPLOY_DRY_RUN=1
  PI5_DEPLOY_TEST_ALLOW_DIRTY_WORKTREE=1
  PI5_MIN_FREE_MEMORY_MB=0
  PI5_MIN_FREE_DISK_GB=0
)

sha="$(git -C "$ROOT" rev-parse HEAD)"
output="$(env "${common_env[@]}" "$SCRIPT" prepare --ref "$sha")"
assert_contains "$output" "candidate prepared"
[[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["event"])' "$TMP/state.json")" == prepared ]] || fail "state is not prepared"

status="$(env "${common_env[@]}" "$SCRIPT" status)"
assert_contains "$status" '"event": "prepared"'
assert_contains "$status" '"rollbackEligible": false'

if env "${common_env[@]}" "$SCRIPT" rollback >/dev/null 2>&1; then
  fail "rollback was accepted for a prepared-only candidate"
fi

for file in \
  "$ROOT/infrastructure/docker/maintenance.html" \
  "$ROOT/infrastructure/docker/Caddyfile.maintenance.local" \
  "$ROOT/infrastructure/docker/Caddyfile.maintenance.http" \
  "$ROOT/infrastructure/docker/Caddyfile.maintenance.production"; do
  [[ -s "$file" ]] || fail "maintenance asset is missing: $file"
done

if env "${common_env[@]}" "$SCRIPT" prepare --ref short >/dev/null 2>&1; then
  fail "short SHA was accepted"
fi

if command -v flock >/dev/null 2>&1; then
  flock "$TMP/lock" /bin/sh -c 'touch "$1"; while :; do sleep 1; done' sh "$TMP/flock-ready" &
  LOCK_HOLDER_PID=$!
  for _ in {1..50}; do
    [[ -f "$TMP/flock-ready" ]] && break
    sleep 0.1
  done
  [[ -f "$TMP/flock-ready" ]] || fail "kernel lock holder did not start"
  if env "${common_env[@]}" "$SCRIPT" status >/dev/null 2>&1; then
    fail "concurrent kernel lock was ignored"
  fi
  kill "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
  wait "$LOCK_HOLDER_PID" 2>/dev/null || true
  LOCK_HOLDER_PID=""
else
  mkdir "$TMP/lock.d"
  if env "${common_env[@]}" "$SCRIPT" status >/dev/null 2>&1; then
    fail "concurrent fallback lock was ignored"
  fi
  rmdir "$TMP/lock.d"
fi

echo "PASS: pi5 image deployment lifecycle"
