#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-image-deploy.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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
[[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build"]["mode"])' "$TMP/state.json")" == built ]] || fail "prepared state did not record the candidate build mode"
grep -Fq 'SIGNAGE_RENDER_ENABLED=false' "$SCRIPT" || fail "candidate validation does not disable signage rendering"
grep -Fq 'image_matches_candidate' "$SCRIPT" || fail "candidate image reuse guard is missing"
grep -Fq 'BUILD_CONFIG_HASH' "$ROOT/infrastructure/docker/Dockerfile.api" || fail "API image is not labelled with its compose configuration hash"
grep -Fq 'BUILD_CONFIG_HASH' "$ROOT/infrastructure/docker/Dockerfile.web" || fail "Web image is not labelled with its compose configuration hash"
grep -Fq 'wait_for_stable_load pre-build' "$SCRIPT" || fail "candidate build lacks pre-build stable-load wait"
grep -Fq 'wait_for_stable_load post-build' "$SCRIPT" || fail "candidate build lacks post-build stable-load wait"

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

mkdir "$TMP/lock.d"
if env "${common_env[@]}" "$SCRIPT" status >/dev/null 2>&1; then
  fail "concurrent lock was ignored"
fi
rmdir "$TMP/lock.d"

echo "PASS: pi5 image deployment lifecycle"
