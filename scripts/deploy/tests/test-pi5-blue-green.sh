#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-blue-green.sh"
TMP="$(mktemp -d)"
DOCKER_ENV_STUB="$ROOT/infrastructure/docker/.env"
CREATED_DOCKER_ENV_STUB=0
cleanup() {
  rm -rf "$TMP"
  if [[ "$CREATED_DOCKER_ENV_STUB" -eq 1 ]]; then
    rm -f "$DOCKER_ENV_STUB"
  fi
}
trap cleanup EXIT

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

OLD_API='registry/api:old'
OLD_WEB='registry/web:old'
NEW_API='registry/api:new'
NEW_WEB='registry/web:new'

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
  PI5_BLUE_GREEN_ALERTS_DIR="$TMP/alerts"
)

STATE1="$TMP/state-one.json"
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB")"
assert_contains "$out" "bootstrap completed"
[[ "$(state "$STATE1" activeSlot)" == blue ]] || fail "blue was not active after bootstrap"
[[ "$(state "$STATE1" version)" == 2 ]] || fail "state schema is not v2"
[[ "$(state "$STATE1" legacy.caddyConfigPath)" == /srv/Caddyfile ]] || fail "legacy Caddyfile path was not persisted"
[[ "$(state "$STATE1" legacy.web.removed)" == True ]] || fail "bootstrap did not release legacy Web port ownership"

out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" prepare --api-image "$NEW_API" --web-image "$NEW_WEB")"
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

# Re-prepare/switch then cleanup after stability window
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" prepare --api-image "$NEW_API" --web-image "$NEW_WEB")"
assert_contains "$out" "candidate prepared"
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" switch)"
assert_contains "$out" "switch completed"
sleep 2
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" cleanup)"
assert_contains "$out" "cleaned"
[[ "$(state "$STATE1" previousSlot)" == "" ]] || fail "cleanup left previousSlot set"

out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" reconcile)"
assert_contains "$out" "reconciled"

# status is observation-only, but must not describe a live active slot as
# consistent when Docker no longer has either of that slot's containers.
STATE_ACTIVE_CONTAINERS_ABSENT="$TMP/state-active-containers-absent.json"
STATE_ACTIVE_CONTAINERS_ABSENT_BEFORE="$TMP/state-active-containers-absent-before.json"
cp "$STATE1" "$STATE_ACTIVE_CONTAINERS_ABSENT"
cp "$STATE1" "$STATE_ACTIVE_CONTAINERS_ABSENT_BEFORE"
mkdir -p "$TMP/docker-stub"
ln -s /usr/bin/true "$TMP/docker-stub/docker"
if status_output="$(env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PATH="$TMP/docker-stub:$PATH" \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_ACTIVE_CONTAINERS_ABSENT" "$SCRIPT" status 2>&1)"; then
  fail "status accepted an active slot whose containers are absent"
fi
assert_contains "$status_output" '"runtimeStatus": "stale"'
cmp -s "$STATE_ACTIVE_CONTAINERS_ABSENT" "$STATE_ACTIVE_CONTAINERS_ABSENT_BEFORE" \
  || fail "status mutated state while reporting absent active containers"

STATE2="$TMP/state-resource.json"
if env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE2" PI5_BLUE_GREEN_TEST_MEMORY_MB=512 "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null 2>&1; then
  fail "resource guard accepted insufficient memory"
fi
[[ ! -f "$STATE2" ]] || fail "resource failure wrote active state"

# Malformed state must fail closed.
STATE_BAD="$TMP/state-bad.json"
printf 'not-json\n' >"$STATE_BAD"
if env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_BAD" "$SCRIPT" status >/dev/null 2>&1; then
  fail "malformed state was accepted by status"
fi

LOCK="$TMP/held.lock"
LOCK_STATE="$TMP/state-lock.json"
LOCK_CONFIG="$TMP/config-lock"
mkdir -p "$LOCK_CONFIG"
env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
  "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null
if command -v flock >/dev/null 2>&1; then
  flock -n "$LOCK" sleep 2 &
  holder=$!
  sleep 0.1
  # status must remain available while another mutating command holds the lock
  status_err="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
    PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" status 2>&1 >/dev/null)" || true
  if grep -Fq 'another Pi5 Blue/Green operation is running' <<<"$status_err"; then
    kill "$holder" 2>/dev/null || true
    fail "status was blocked by the exclusive deploy lock"
  fi
  env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
    PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" status >/dev/null \
    || { kill "$holder" 2>/dev/null || true; fail "status failed unexpectedly while lock was held"; }
  prepare_err="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
    PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" prepare --api-image "$NEW_API" --web-image "$NEW_WEB" 2>&1 >/dev/null)" || true
  if ! grep -Fq 'another Pi5 Blue/Green operation is running' <<<"$prepare_err"; then
    kill "$holder" 2>/dev/null || true
    fail "concurrent mutating operation was accepted"
  fi
  wait "$holder" || true
else
  mkdir "${LOCK}.d"
  status_err="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
    PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" status 2>&1 >/dev/null)" || true
  if grep -Fq 'another Pi5 Blue/Green operation is running' <<<"$status_err"; then
    rmdir "${LOCK}.d"
    fail "status was blocked by the exclusive deploy lock"
  fi
  env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
    PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" status >/dev/null \
    || { rmdir "${LOCK}.d"; fail "status failed unexpectedly while lock was held"; }
  prepare_err="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$LOCK_STATE" PI5_BLUE_GREEN_CONFIG_DIR="$LOCK_CONFIG" \
    PI5_BLUE_GREEN_LOCK_FILE="$LOCK" "$SCRIPT" prepare --api-image "$NEW_API" --web-image "$NEW_WEB" 2>&1 >/dev/null)" || true
  if ! grep -Fq 'another Pi5 Blue/Green operation is running' <<<"$prepare_err"; then
    rmdir "${LOCK}.d"
    fail "concurrent mutating operation was accepted"
  fi
  rmdir "${LOCK}.d"
fi

# Weak JWT secrets must fail closed before candidate start.
WEAK_ENV="$TMP/weak.env"
printf '%s\n' 'VITE_API_BASE_URL=/api' 'JWT_ACCESS_SECRET=replace-me' 'JWT_REFRESH_SECRET=change-me-too-but-still-weak' >"$WEAK_ENV"
if env "${common[@]}" PI5_ENV_FILE="$WEAK_ENV" PI5_BLUE_GREEN_STATE_FILE="$TMP/weak-jwt.json" \
  "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null 2>&1; then
  fail "secret guard accepted placeholder JWT secrets"
fi
[[ ! -f "$TMP/weak-jwt.json" ]] || fail "weak JWT failure wrote Blue/Green state"

# Referenced slots must retain complete image pairs; otherwise reconcile must
# fail before it can compose an image selected from corrupted state.
STATE_MISSING_IMAGES="$TMP/state-missing-images.json"
env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_MISSING_IMAGES" "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null
python3 - "$STATE_MISSING_IMAGES" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    state = json.load(f)
state['slots']['blue']['images']['api'] = None
with open(path, 'w', encoding='utf-8') as f:
    json.dump(state, f)
PY
if env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_MISSING_IMAGES" "$SCRIPT" status >/dev/null 2>&1; then
  fail "state with missing active-slot image was accepted"
fi

# Incomplete bootstrap recovery must prefer legacy restore, else retain gateway maintenance.
STATE_BOOT="$TMP/state-bootstrapping.json"
env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_BOOT" "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null
python3 - "$STATE_BOOT" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    state = json.load(f)
state['event'] = 'bootstrapping'
state['activeSlot'] = None
state['candidateSlot'] = 'blue'
state['previousSlot'] = None
state['gateway'] = {'mode': 'maintenance', 'slot': None}
state['stableUntil'] = None
state['monitor'] = {'activeSlot': None, 'rollbackSlot': None}
with open(path, 'w', encoding='utf-8') as f:
    json.dump(state, f)
PY
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_BOOT" "$SCRIPT" reconcile)"
assert_contains "$out" "legacy API/Web restored after incomplete bootstrap"
[[ "$(state "$STATE_BOOT" event)" == legacy-restored ]] || fail "bootstrapping reconcile did not restore legacy"

STATE_REWRITE="$TMP/state-rewrite.json"
env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_REWRITE" "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null
grep -Fq 'refusing compose up (possible rewritten state)' "$SCRIPT" || fail "reconcile identity guard is missing"
grep -Fq 'legacy_compose_restore' "$SCRIPT" || fail "legacy restore does not use captured images"
grep -Fq 'ensure_gateway_maintenance' "$SCRIPT" || fail "bootstrap failure path lacks gateway maintenance retention"
grep -Fq 'spawn_stability_monitor' "$SCRIPT" || fail "reboot/reconcile monitor resume helper is missing"
grep -Fq 'Expand-only allow-list' "$SCRIPT" || fail "migration allow-list guard is missing"
grep -Fq 'historical_migration_matches_database()' "$SCRIPT" \
  || fail "completed historical migration checksum guard is missing"
grep -Fq 'finished_at IS NOT NULL AND rolled_back_at IS NULL' "$SCRIPT" \
  || fail "historical migration guard accepts incomplete or rolled-back migrations"
grep -Fq 'migration_file_checksum' "$SCRIPT" \
  || fail "historical migration guard does not verify file checksum"
grep -Fq "compose_current run --rm --no-deps \"api-\${candidate}\" sh -lc './node_modules/.bin/prisma migrate status'" "$SCRIPT" \
  || fail "candidate migration command does not bypass the API default Node command"
grep -Fq 'legacy_caddy_config_path()' "$SCRIPT" \
  || fail "legacy active Caddyfile detection is missing"
grep -Fq '/srv/Caddyfile.local' "$SCRIPT" \
  || fail "legacy local-TLS Caddyfile path is not handled"
grep -Fq '/srv/Caddyfile.production' "$SCRIPT" \
  || fail "legacy production Caddyfile path is not handled"
grep -Fq 'LEGACY_MAINTENANCE_LOCAL_CONFIG' "$SCRIPT" \
  || fail "legacy local-TLS maintenance configuration is not selected"
grep -Fq "'caddyConfigPath': maybe(legacy_caddy_path)" "$SCRIPT" \
  || fail "legacy active Caddyfile path is not durable state"
grep -Fq 'caddy reload --config "$caddy_path" --adapter caddyfile' "$SCRIPT" \
  || fail "legacy Caddy reload does not use the captured active path"
grep -Fq 'gateway_smoke_url()' "$SCRIPT" \
  || fail "gateway startup smoke retry helper is missing"
grep -Fq 'PI5_BLUE_GREEN_GATEWAY_READY_RETRIES' "$SCRIPT" \
  || fail "gateway startup retry budget is not configurable"
grep -Fq 'GATEWAY_READY_RETRIES="${PI5_BLUE_GREEN_GATEWAY_READY_RETRIES:-60}"' "$SCRIPT" \
  || fail "gateway startup retry budget does not cover Pi5 port handoff"
grep -Fq 'for attempt in $(seq 1 "$GATEWAY_READY_RETRIES")' "$SCRIPT" \
  || fail "gateway startup smoke does not retry before rollback"
grep -Fq 'docker rm "$LEGACY_WEB_ID"' "$SCRIPT" \
  || fail "legacy Web container is not removed before gateway port handoff"
grep -Fq 'compose_current up -d --force-recreate gateway' "$SCRIPT" \
  || fail "gateway restart can reuse a stale port publication container"

PROD_ENV="$TMP/production.env"
printf '%s\n' \
  'JWT_ACCESS_SECRET=production-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz' \
  'JWT_REFRESH_SECRET=production-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz' >"$PROD_ENV"
# Compose v2 auto-loads infrastructure/docker/.env; keep a non-secret stub for local/CI.
if [[ ! -f "$DOCKER_ENV_STUB" ]]; then
  cp "$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env" "$DOCKER_ENV_STUB"
  CREATED_DOCKER_ENV_STUB=1
fi
rendered="$(PI5_BLUE_API_IMAGE="$OLD_API" PI5_GREEN_API_IMAGE="$NEW_API" \
  PI5_BLUE_WEB_IMAGE="$OLD_WEB" PI5_GREEN_WEB_IMAGE="$NEW_WEB" PI5_GATEWAY_IMAGE="$NEW_WEB" \
  PI5_PROJECT_DIR="$ROOT" PI5_ENV_FILE="$PROD_ENV" docker compose -f "$ROOT/infrastructure/docker/docker-compose.phase3.yml" config)"
assert_contains "$rendered" 'JWT_ACCESS_SECRET: production-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
assert_contains "$rendered" 'JWT_REFRESH_SECRET: production-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
[[ "$(grep -c 'restart: unless-stopped' <<<"$rendered")" -eq 5 ]] || fail "all Phase 3 services must use unless-stopped"

legacy_restore_cfg="$(PI5_LEGACY_API_IMAGE="$OLD_API" PI5_LEGACY_WEB_IMAGE="$OLD_WEB" \
  PI5_PROJECT_DIR="$ROOT" PI5_ENV_FILE="$PROD_ENV" \
  docker compose -f "$ROOT/infrastructure/docker/docker-compose.server.yml" \
  -f "$ROOT/infrastructure/docker/docker-compose.legacy-restore.yml" config)"
assert_contains "$legacy_restore_cfg" "image: $OLD_API"
assert_contains "$legacy_restore_cfg" "image: $OLD_WEB"
assert_contains "$legacy_restore_cfg" 'PI5_SCHEDULER_LEADER_ENABLED: "1"'

for caddy_file in \
  infrastructure/docker/Caddyfile.gateway.template \
  infrastructure/docker/Caddyfile.gateway.http.template \
  infrastructure/docker/Caddyfile.gateway.maintenance.template \
  infrastructure/docker/Caddyfile.slot.template \
  infrastructure/docker/Caddyfile.local \
  infrastructure/docker/Caddyfile.local.template \
  infrastructure/docker/Caddyfile.production \
  infrastructure/docker/Caddyfile \
  infrastructure/docker/Caddyfile.maintenance.http \
  infrastructure/docker/Caddyfile.maintenance.local \
  infrastructure/docker/Caddyfile.maintenance.production; do
  grep -Fq 'path /api/system/deploy-readiness/internal' "$ROOT/$caddy_file" || fail "missing internal-readiness matcher in $caddy_file"
  grep -Fq 'respond @internal_deploy_readiness 404' "$ROOT/$caddy_file" || fail "missing internal-readiness block in $caddy_file"
done

for caddy_file in \
  infrastructure/docker/Caddyfile.gateway.maintenance.template \
  infrastructure/docker/Caddyfile.gateway.maintenance.http.template \
  infrastructure/docker/Caddyfile.maintenance.http \
  infrastructure/docker/Caddyfile.maintenance.local \
  infrastructure/docker/Caddyfile.maintenance.production; do
  grep -Fq 'root * /srv/phase2-maintenance' "$ROOT/$caddy_file" || fail "maintenance asset root is not image-backed in $caddy_file"
done
grep -Fq 'COPY infrastructure/docker/maintenance.html ./phase2-maintenance/index.html' "$ROOT/infrastructure/docker/Dockerfile.web" || fail "Web image does not contain the maintenance asset"
grep -Fq 'restore_legacy_after_phase3_stop' "$SCRIPT" || fail "legacy restore does not release gateway ports first"
grep -Fq 'pi5-phase3-legacy-guard.sh' "$ROOT/infrastructure/ansible/roles/server/tasks/main.yml" || fail "server role is missing the Phase 3 legacy guard"
grep -Fq 'name: pi5-blue-green-reconcile.service' "$ROOT/infrastructure/ansible/roles/server/tasks/main.yml" || fail "boot reconcile service is not enabled"

for caddy_file in \
  infrastructure/docker/Caddyfile.gateway.template \
  infrastructure/docker/Caddyfile.production \
  infrastructure/docker/Caddyfile.local \
  infrastructure/docker/Caddyfile.maintenance.production \
  infrastructure/docker/Caddyfile.maintenance.local; do
  python3 - "$ROOT/$caddy_file" <<'PY' || fail "internal readiness 404 is not ordered before HTTPS redirect in $caddy_file"
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
blocks = re.findall(r':80\s*\{.*?\}', text, flags=re.S)
if not blocks:
    raise SystemExit('no :80 block')
for block in blocks:
    if 'redir' not in block:
        continue
    resp = block.find('respond @internal_deploy_readiness 404')
    redir = block.find('redir')
    if resp < 0 or redir < 0 or resp > redir:
        raise SystemExit('404 after redir')
PY
done

grep -Fq 'ansible-update-bluegreen-' "$SCRIPT" || fail "Blue/Green alerts do not use the deploy-alert routing prefix"
grep -Fq "'acknowledged': False" "$SCRIPT" || fail "Blue/Green alert payload is missing acknowledgement state"
grep -Fq 'pi5-phase3-legacy-guard.sh' "$ROOT/scripts/deploy/pi5-image-deploy.sh" || fail "Phase 2 script is missing the Phase 3 legacy guard"

echo "PASS: pi5 blue/green safety lifecycle"
