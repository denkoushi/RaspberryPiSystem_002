#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-blue-green.sh"
MODULE_DIR="$ROOT/scripts/deploy/lib/pi5-blue-green"
SOURCE_FILES=("$SCRIPT")
if [[ -d "$MODULE_DIR" ]]; then
  while IFS= read -r module; do SOURCE_FILES+=("$module"); done < <(
    find "$MODULE_DIR" -type f -name '*.sh' | sort
  )
fi
ALL_SOURCE="$(cat "${SOURCE_FILES[@]}")"
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
extract_function() {
  python3 - "$1" "${SOURCE_FILES[@]}" <<'PY'
import pathlib
import re
import sys

target = sys.argv[1]
matches = []
function_start = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)\(\) \{$')
for raw_path in sys.argv[2:]:
    path = pathlib.Path(raw_path)
    lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
    for index, line in enumerate(lines):
        match = function_start.match(line.rstrip('\n'))
        if not match or match.group(1) != target:
            continue
        end = len(lines)
        for candidate in range(index + 1, len(lines)):
            if function_start.match(lines[candidate].rstrip('\n')):
                end = candidate
                break
        matches.append(''.join(lines[index:end]).rstrip() + '\n')
if len(matches) != 1:
    raise SystemExit(f'expected exactly one definition for {target}, found {len(matches)}')
sys.stdout.write(matches[0])
PY
}
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
  PI5_BLUE_GREEN_TEST_ALLOW_MISSING_RELEASE_EVIDENCE=1
  PI5_BLUE_GREEN_MIN_MEMORY_MB=1536
  PI5_BLUE_GREEN_MIN_DISK_GB=10
  PI5_BLUE_GREEN_LOCK_FILE="$TMP/lock"
  PI5_BLUE_GREEN_CONFIG_DIR="$TMP/config"
  PI5_BLUE_GREEN_STABLE_SECONDS=1
  PI5_BLUE_GREEN_ALERTS_DIR="$TMP/alerts"
)

# The Web image renders its slot configuration into a writable runtime path.
# Exercise the controller function against a container-provided path so a
# Dockerfile/controller path drift fails before a release reaches Pi5.
SLOT_VALIDATE_BIN="$TMP/slot-validate-bin"
SLOT_VALIDATE_CONFIG="$TMP/runtime-Caddyfile.slot"
SLOT_VALIDATE_RECORD="$TMP/slot-validate-record"
mkdir -p "$SLOT_VALIDATE_BIN"
printf 'slot config\n' >"$SLOT_VALIDATE_CONFIG"
cat >"$SLOT_VALIDATE_BIN/caddy" <<'SH'
#!/bin/sh
set -eu
[ "$1" = validate ]
[ "$2" = --config ]
[ "$3" = "$EXPECTED_SLOT_CONFIG" ]
[ -f "$3" ]
printf '%s\n' "$3" >"$SLOT_VALIDATE_RECORD"
SH
chmod +x "$SLOT_VALIDATE_BIN/caddy"
slot_web_validate_function="$(extract_function slot_web_validate)"
EXPECTED_SLOT_CONFIG="$SLOT_VALIDATE_CONFIG" \
SLOT_VALIDATE_RECORD="$SLOT_VALIDATE_RECORD" \
PATH="$SLOT_VALIDATE_BIN:$PATH" \
bash -euo pipefail -c "
$slot_web_validate_function
DRY_RUN=0
slot_container_id() { printf '%s\\n' candidate-web; }
docker() {
  [[ \"\$1\" == exec && \"\$2\" == candidate-web ]]
  shift 2
  SLOT_CADDY_CONFIG_FILE=\"\$EXPECTED_SLOT_CONFIG\" \"\$@\"
}
slot_web_validate green
"
[[ "$(cat "$SLOT_VALIDATE_RECORD")" == "$SLOT_VALIDATE_CONFIG" ]] \
  || fail "slot Web validation did not use the container-provided runtime config"
LEGACY_SLOT_VALIDATE_RECORD="$TMP/legacy-slot-validate-record"
LEGACY_SLOT_VALIDATE_RECORD="$LEGACY_SLOT_VALIDATE_RECORD" \
bash -euo pipefail -c "
$slot_web_validate_function
DRY_RUN=0
slot_container_id() { printf '%s\\n' legacy-web; }
docker() {
  [[ \"\$1\" == exec && \"\$2\" == legacy-web ]]
  case \"\$3\" in
    sh)
      printf ''
      ;;
    test)
      [[ \"\$4\" == -f && \"\$5\" == /srv/Caddyfile.slot ]]
      ;;
    caddy)
      [[ \"\$4\" == validate && \"\$5\" == --config && \"\$6\" == /srv/Caddyfile.slot ]]
      printf '%s\\n' \"\$6\" >\"\$LEGACY_SLOT_VALIDATE_RECORD\"
      ;;
    *)
      return 1
      ;;
  esac
}
slot_web_validate blue
"
[[ "$(cat "$LEGACY_SLOT_VALIDATE_RECORD")" == /srv/Caddyfile.slot ]] \
  || fail "slot Web validation broke the active legacy image contract"
slot_up_function="$(extract_function slot_up)"
bash -euo pipefail -c "
$slot_up_function
compose_current() { return 0; }
verify_slot_runtime_config() { return 0; }
slot_runtime_ready() { return 0; }
slot_web_validate() { return 1; }
if slot_up green standby; then
  exit 1
fi
[[ \"\$SLOT_UP_FAILURE_REASON\" == 'candidate green Web slot configuration is invalid' ]]
"

# Lock the public CLI surface before functions move out of the entrypoint.
help_output="$("$SCRIPT" status --help)"
assert_contains "$help_output" 'Usage: pi5-blue-green.sh <status|bootstrap|prepare|switch|rollback|cleanup|reconcile|monitor>'
if unknown_output="$("$SCRIPT" unknown-command 2>&1)"; then
  fail 'unknown command was accepted'
else
  [[ "$?" -eq 2 ]] || fail 'unknown command did not return exit code 2'
fi
assert_contains "$unknown_output" 'Usage: pi5-blue-green.sh'
UNINITIALIZED_STATE="$TMP/not-initialized.json"
uninitialized_status="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$UNINITIALIZED_STATE" "$SCRIPT" status)"
[[ "$uninitialized_status" == '{"state":"not-initialized"}' ]] \
  || fail "uninitialized status contract changed: $uninitialized_status"
[[ ! -e "$UNINITIALIZED_STATE" ]] || fail 'status created an uninitialized state file'

STATE1="$TMP/state-one.json"
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB")"
assert_contains "$out" "bootstrap completed"
[[ "$(state "$STATE1" activeSlot)" == blue ]] || fail "blue was not active after bootstrap"
[[ "$(state "$STATE1" version)" == 2 ]] || fail "state schema is not v2"
[[ "$(state "$STATE1" legacy.caddyConfigPath)" == /srv/Caddyfile ]] || fail "legacy Caddyfile path was not persisted"
[[ "$(state "$STATE1" legacy.web.removed)" == True ]] || fail "bootstrap did not release legacy Web port ownership"

if env "${common[@]}" PI5_BLUE_GREEN_TEST_ALLOW_MISSING_RELEASE_EVIDENCE=0 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" prepare \
  --api-image "$NEW_API" --web-image "$NEW_WEB" >/dev/null 2>&1; then
  fail "candidate preparation accepted missing run-scoped evidence"
fi

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
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE1" "$SCRIPT" cleanup)"
assert_contains "$out" "rollback cleanup completed"
[[ "$(state "$STATE1" previousSlot)" == "" ]] || fail "rollback cleanup left previousSlot set"
[[ "$(state "$STATE1" event)" == rollback-cleaned ]] || fail "rollback cleanup evidence is missing"

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
if status_output="$(env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 PATH="$TMP/docker-stub:$PATH" \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_ACTIVE_CONTAINERS_ABSENT" "$SCRIPT" status 2>&1)"; then
  fail "status accepted an active slot whose containers are absent"
fi
assert_contains "$status_output" '"runtimeStatus": "stale"'
cmp -s "$STATE_ACTIVE_CONTAINERS_ABSENT" "$STATE_ACTIVE_CONTAINERS_ABSENT_BEFORE" \
  || fail "status mutated state while reporting absent active containers"

# A live slot with the expected images but stale effective environment must
# make status fail closed. pi5_already_current treats this non-zero status as
# not current, so a same-SHA configuration drift cannot take the skip path.
STATE_RUNTIME_DRIFT="$TMP/state-runtime-drift.json"
STATE_RUNTIME_DRIFT_BEFORE="$TMP/state-runtime-drift-before.json"
cp "$STATE1" "$STATE_RUNTIME_DRIFT"
cp "$STATE1" "$STATE_RUNTIME_DRIFT_BEFORE"
python3 - "$STATE_RUNTIME_DRIFT" "$STATE_RUNTIME_DRIFT_BEFORE" <<'PY'
import json, sys
for raw in sys.argv[1:]:
    with open(raw, encoding='utf-8') as stream:
        state=json.load(stream)
    state['slots']['green']['imageIds']={
        'api':'sha256:' + '1' * 64,
        'web':'sha256:' + '2' * 64,
    }
    with open(raw, 'w', encoding='utf-8') as stream:
        json.dump(state, stream)
PY
RUNTIME_DRIFT_STUB="$TMP/runtime-drift-stub"
mkdir -p "$RUNTIME_DRIFT_STUB"
cat >"$RUNTIME_DRIFT_STUB/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == compose ]]; then
  service="${!#}"
  case "$service" in
    api-green) printf 'api-green-cid\n' ;;
    web-green) printf 'web-green-cid\n' ;;
  esac
  exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  container="${!#}"
  format="${3:-}"
  case "$container" in
    api-green-cid)
      if [[ "$format" == '{{.Image}}' ]]; then
        [[ "${RETARGET_IMAGE_IDS:-0}" == 1 ]] \
          && printf 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\n' \
          || printf 'sha256:1111111111111111111111111111111111111111111111111111111111111111\n'
      else
        printf '%s\n' "${EXPECTED_API_IMAGE:?}"
      fi
      ;;
    web-green-cid)
      if [[ "$format" == '{{.Image}}' ]]; then
        [[ "${RETARGET_IMAGE_IDS:-0}" == 1 ]] \
          && printf 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n' \
          || printf 'sha256:2222222222222222222222222222222222222222222222222222222222222222\n'
      else
        printf '%s\n' "${EXPECTED_WEB_IMAGE:?}"
      fi
      ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "${1:-}" == exec ]]; then
  container="${2:-}"
  if [[ "${FAIL_SCHEDULER_HEALTH:-0}" == 1 && "$container" == api-* ]]; then
    exit 1
  fi
  if [[ "${FAIL_WEB_HEALTH:-0}" == 1 && "$container" == web-* ]]; then
    exit 1
  fi
  exit 0
fi
exit 1
SH
cat >"$RUNTIME_DRIFT_STUB/curl" <<'SH'
#!/usr/bin/env bash
[[ "${FAIL_GATEWAY_HEALTH:-0}" != 1 ]]
SH
cat >"$RUNTIME_DRIFT_STUB/runtime-config-verifier" <<'SH'
#!/usr/bin/env python3
import sys
print('ERROR: runtime API environment does not match effective Compose: LOCAL_LLM_MODEL', file=sys.stderr)
raise SystemExit(1)
SH
cat >"$RUNTIME_DRIFT_STUB/runtime-config-ok" <<'SH'
#!/usr/bin/env python3
print('sha256:' + 'a' * 64)
SH
chmod +x "$RUNTIME_DRIFT_STUB/docker" "$RUNTIME_DRIFT_STUB/curl" \
  "$RUNTIME_DRIFT_STUB/runtime-config-verifier" "$RUNTIME_DRIFT_STUB/runtime-config-ok"
if runtime_drift_output="$(env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
  PI5_RUNTIME_CONFIG_VERIFIER="$RUNTIME_DRIFT_STUB/runtime-config-verifier" \
  EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
  PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status 2>&1)"; then
  fail "status accepted same-SHA active images with mismatched runtime environment"
fi
assert_contains "$runtime_drift_output" 'runtime API environment does not match effective Compose'
assert_contains "$runtime_drift_output" '"runtimeConfigStatus": "mismatch"'
assert_contains "$runtime_drift_output" '"runtimeStatus": "stale"'
cmp -s "$STATE_RUNTIME_DRIFT" "$STATE_RUNTIME_DRIFT_BEFORE" \
  || fail "runtime environment drift status mutated durable state"

# The same tag text is insufficient: a recreated container using a retargeted
# image ID must be stale before switch, monitor, rollback, or reconcile can use it.
if retarget_output="$(env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
  PI5_RUNTIME_CONFIG_VERIFIER="$RUNTIME_DRIFT_STUB/runtime-config-ok" \
  RETARGET_IMAGE_IDS=1 EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
  PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status 2>&1)"; then
  fail "status accepted containers recreated from retargeted image tags"
fi
assert_contains "$retarget_output" '"runtimeStatus": "stale"'

# A structurally correct same-SHA slot is not live release evidence unless the
# active scheduler, Web process, and gateway API/Web smoke all pass now.
healthy_status="$(env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
  PI5_RUNTIME_CONFIG_VERIFIER="$RUNTIME_DRIFT_STUB/runtime-config-ok" \
  EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
  PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status)"
assert_contains "$healthy_status" '"liveHealthStatus": "verified"'
for failure in scheduler web gateway; do
  failure_env=()
  case "$failure" in
    scheduler) failure_env+=(FAIL_SCHEDULER_HEALTH=1) ;;
    web) failure_env+=(FAIL_WEB_HEALTH=1) ;;
    gateway) failure_env+=(FAIL_GATEWAY_HEALTH=1) ;;
  esac
  if health_output="$(env "${common[@]}" "${failure_env[@]}" \
    PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
    PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
    PI5_RUNTIME_CONFIG_VERIFIER="$RUNTIME_DRIFT_STUB/runtime-config-ok" \
    EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
    PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status 2>&1)"; then
    fail "status accepted failed ${failure} live health"
  fi
  assert_contains "$health_output" '"liveHealthStatus": "failed"'
  assert_contains "$health_output" '"runtimeStatus": "stale"'
done

if env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=1 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" PATH="$RUNTIME_DRIFT_STUB:$PATH" \
  "$SCRIPT" status >/dev/null 2>&1; then
  fail "production accepted a stability hold shorter than 300 seconds"
fi
if env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" PATH="$RUNTIME_DRIFT_STUB:$PATH" \
  "$SCRIPT" reconcile >/dev/null 2>&1; then
  fail "production mutation accepted test-only resource evidence overrides"
fi

# Coordinator-owned production policy is exact: thresholds/timings cannot be
# shortened and Docker/Compose routing cannot be redirected through inherited
# environment. These checks run before state or Docker access.
protocol_env=(
  PI5_PROJECT_DIR="$ROOT"
  PI5_BLUE_GREEN_DRY_RUN=0
  PI5_BLUE_GREEN_STATE_FILE="$TMP/protocol-state.json"
  PI5_BLUE_GREEN_LOCK_FILE="$TMP/protocol-lock"
  ROLLING_RELEASE_PROTOCOL=2
  ROLLING_RELEASE_UNIT=raspi-release-run-protocol.service
)
if protocol_error="$(env "${protocol_env[@]}" PI5_BLUE_GREEN_MAX_ERROR_RATE=0.10 \
  "$SCRIPT" status 2>&1)"; then
  fail "rolling-release accepted a relaxed Blue/Green error threshold"
fi
assert_contains "$protocol_error" 'maximum error rate is fixed at 0.05'
if protocol_error="$(env "${protocol_env[@]}" PI5_BLUE_GREEN_READINESS_RETRIES=1 \
  "$SCRIPT" status 2>&1)"; then
  fail "rolling-release accepted shortened slot readiness timing"
fi
assert_contains "$protocol_error" 'slot readiness timing is fixed at 45 attempts / 2 seconds'
if protocol_error="$(env "${protocol_env[@]}" DOCKER_CONTEXT=unexpected \
  "$SCRIPT" status 2>&1)"; then
  fail "rolling-release accepted Docker context redirection"
fi
assert_contains "$protocol_error" 'Docker/Compose control environment is forbidden under rolling-release: DOCKER_CONTEXT'

# Prior-release handoff inspection must remain available after a desired
# configuration change. It proves structure only and never grants release
# verification; the normal status path above remains fail-closed. The mode is
# hidden and bound to the active coordinator-owned fleet run.
FLEET_RUNTIME_DRIFT="$TMP/fleet-runtime-drift.json"
cat >"$FLEET_RUNTIME_DRIFT" <<'JSON'
{"activeRun":{"runId":"run-1","status":"running"}}
JSON
if env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
  PI5_RUNTIME_CONFIG_VERIFIER="$RUNTIME_DRIFT_STUB/runtime-config-verifier" \
  EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
  PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status --structural-only >/dev/null 2>&1; then
  fail "public CLI accepted the internal structural recovery option"
fi
if env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
  PI5_PRIOR_HANDOFF_RECOVERY_RUN_ID=run-1 \
  PI5_FLEET_STATE_FILE="$TMP/missing-fleet-state.json" \
  ROLLING_RELEASE_PROTOCOL=2 ROLLING_RELEASE_UNIT=raspi-release-run-1.service \
  INVOCATION_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
  PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status >/dev/null 2>&1; then
  fail "structural recovery accepted a missing active fleet run"
fi
structural_output="$(env "${common[@]}" PI5_BLUE_GREEN_DRY_RUN=0 PI5_BLUE_GREEN_STABLE_SECONDS=300 \
  PI5_BLUE_GREEN_STATE_FILE="$STATE_RUNTIME_DRIFT" \
  PI5_PRIOR_HANDOFF_RECOVERY_RUN_ID=run-1 \
  PI5_FLEET_STATE_FILE="$FLEET_RUNTIME_DRIFT" \
  ROLLING_RELEASE_PROTOCOL=2 ROLLING_RELEASE_UNIT=raspi-release-run-1.service \
  INVOCATION_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  PI5_RUNTIME_CONFIG_VERIFIER="$RUNTIME_DRIFT_STUB/runtime-config-verifier" \
  EXPECTED_API_IMAGE="$NEW_API" EXPECTED_WEB_IMAGE="$NEW_WEB" \
  PATH="$RUNTIME_DRIFT_STUB:$PATH" "$SCRIPT" status)"
assert_contains "$structural_output" '"runtimeConfigStatus": "not-checked"'
assert_contains "$structural_output" '"runtimeStatus": "consistent"'

# A deployed pre-PR6 schema-v2 state has slot tags but no imageIds. The
# coordinator-owned one-time adapter must seal the referenced live slot before
# strict status can run; status itself remains observation-only.
LEGACY_IDS_STATE="$TMP/state-legacy-image-ids.json"
LEGACY_IDS_FLEET="$TMP/fleet-legacy-image-ids.json"
LEGACY_IDS_BIN="$TMP/legacy-image-id-bin"
cp "$STATE1" "$LEGACY_IDS_STATE"
python3 - "$LEGACY_IDS_STATE" <<'PY'
import json, sys
path=sys.argv[1]
state=json.load(open(path, encoding='utf-8'))
for slot in state['slots'].values():
    slot.pop('imageIds', None)
json.dump(state, open(path, 'w', encoding='utf-8'))
PY
cat >"$LEGACY_IDS_FLEET" <<'JSON'
{"activeRun":{"runId":"run-legacy-seal","status":"running"}}
JSON
mkdir -p "$LEGACY_IDS_BIN"
cat >"$LEGACY_IDS_BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == compose ]]; then
  service="${!#}"
  case "$service" in
    api-green) printf '%s\n' api-green-cid ;;
    web-green) printf '%s\n' web-green-cid ;;
    api-blue|web-blue) : ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  format="${3:-}"; container="${4:-}"
  case "$format:$container" in
    '{{.State.Running}}':*) printf '%s\n' true ;;
    '{{.Config.Image}}':api-green-cid) printf '%s\n' "${EXPECTED_API_IMAGE:?}" ;;
    '{{.Config.Image}}':web-green-cid) printf '%s\n' "${EXPECTED_WEB_IMAGE:?}" ;;
    '{{.Image}}':api-green-cid) printf 'sha256:%064d\n' 1 ;;
    '{{.Image}}':web-green-cid) printf 'sha256:%064d\n' 2 ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "${1:-}" == image && "${2:-}" == inspect ]]; then
  image="${!#}"
  case "$image" in
    "${EXPECTED_API_IMAGE:?}") printf 'sha256:%064d\n' 1 ;;
    "${EXPECTED_WEB_IMAGE:?}") printf 'sha256:%064d\n' 2 ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "${1:-}" == exec ]]; then
  exit 0
fi
exit 1
SH
cat >"$LEGACY_IDS_BIN/curl" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$LEGACY_IDS_BIN/docker" "$LEGACY_IDS_BIN/curl"
legacy_active_api="$(state "$LEGACY_IDS_STATE" slots.green.images.api)"
legacy_active_web="$(state "$LEGACY_IDS_STATE" slots.green.images.web)"
legacy_protocol_env=(
  PI5_PROJECT_DIR="$ROOT"
  PI5_PHASE3_COMPOSE="$ROOT/infrastructure/docker/docker-compose.phase3.yml"
  PI5_ENV_FILE="$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env"
  PI5_BLUE_GREEN_DRY_RUN=0
  PI5_BLUE_GREEN_STABLE_SECONDS=300
  PI5_BLUE_GREEN_STATE_FILE="$LEGACY_IDS_STATE"
  PI5_BLUE_GREEN_CONFIG_DIR="$TMP/config"
  PI5_BLUE_GREEN_LOCK_FILE="$TMP/legacy-image-id-lock"
  PI5_PRIOR_HANDOFF_RECOVERY_RUN_ID=run-legacy-seal
  PI5_FLEET_STATE_FILE="$LEGACY_IDS_FLEET"
  ROLLING_RELEASE_PROTOCOL=2
  ROLLING_RELEASE_UNIT=raspi-release-run-legacy-seal.service
  INVOCATION_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  EXPECTED_API_IMAGE="$legacy_active_api"
  EXPECTED_WEB_IMAGE="$legacy_active_web"
  PATH="$LEGACY_IDS_BIN:$PATH"
)
seal_output="$(env "${legacy_protocol_env[@]}" "$SCRIPT" seal-image-ids)"
assert_contains "$seal_output" 'sealed legacy schema-v2 slot image identities'
[[ "$(state "$LEGACY_IDS_STATE" slots.green.imageIds.api)" == "sha256:$(printf '%064d' 1)" ]] \
  || fail "legacy API image ID was not sealed"
[[ "$(state "$LEGACY_IDS_STATE" slots.green.imageIds.web)" == "sha256:$(printf '%064d' 2)" ]] \
  || fail "legacy Web image ID was not sealed"
seal_output="$(env "${legacy_protocol_env[@]}" "$SCRIPT" seal-image-ids)"
assert_contains "$seal_output" 'already sealed'
legacy_status="$(env "${legacy_protocol_env[@]}" "$SCRIPT" status)"
assert_contains "$legacy_status" '"runtimeStatus": "consistent"'

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
state['event'] = 'bootstrap-preparing'
state['activeSlot'] = None
state['candidateSlot'] = 'blue'
state['previousSlot'] = None
state['gateway'] = {'mode': 'maintenance', 'slot': None}
state['stableUntil'] = None
state['monitor'] = {'activeSlot': None, 'rollbackSlot': None}
state['legacy']['web']['removeIntent'] = True
state['legacy']['web']['removed'] = False
with open(path, 'w', encoding='utf-8') as f:
    json.dump(state, f)
PY
out="$(env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_BOOT" "$SCRIPT" reconcile)"
assert_contains "$out" "legacy API/Web restored after incomplete bootstrap"
[[ "$(state "$STATE_BOOT" event)" == legacy-restored ]] || fail "bootstrapping reconcile did not restore legacy"
[[ "$(state "$STATE_BOOT" legacy.web.removed)" == False \
  && "$(state "$STATE_BOOT" legacy.web.removeIntent)" == False ]] \
  || fail "bootstrap takeover did not resolve durable legacy Web deletion intent"

# Recovery authority must precede the first forward migration and inactive
# slot start for both bootstrap and normal prepare. This order is the SIGKILL
# takeover boundary; traps cover catchable failures after the durable save.
bootstrap_body="$(extract_function bootstrap)"
prepare_body="$(extract_function prepare)"
bootstrap_state_line="$(grep -n 'state_save bootstrap-preparing' <<<"$bootstrap_body" | cut -d: -f1)"
bootstrap_arm_line="$(grep -nE '^[[:space:]]*arm_bootstrap_recovery$' <<<"$bootstrap_body" | cut -d: -f1)"
bootstrap_migration_line="$(grep -n 'migration_apply_and_verify blue' <<<"$bootstrap_body" | cut -d: -f1)"
bootstrap_slot_line="$(grep -n 'slot_up blue standby' <<<"$bootstrap_body" | cut -d: -f1)"
((bootstrap_state_line < bootstrap_arm_line \
  && bootstrap_arm_line < bootstrap_migration_line \
  && bootstrap_migration_line < bootstrap_slot_line)) \
  || fail 'bootstrap recovery authority/trap is not sealed before migration and slot start'
prepare_state_line="$(grep -n 'state_save preparing' <<<"$prepare_body" | cut -d: -f1)"
prepare_arm_line="$(grep -nE '^[[:space:]]*arm_prepare_recovery$' <<<"$prepare_body" | cut -d: -f1)"
prepare_migration_line="$(grep -n 'migration_apply_and_verify "$candidate"' <<<"$prepare_body" | cut -d: -f1)"
prepare_slot_line="$(grep -n 'slot_up "$candidate" standby' <<<"$prepare_body" | cut -d: -f1)"
((prepare_state_line < prepare_arm_line \
  && prepare_arm_line < prepare_migration_line \
  && prepare_migration_line < prepare_slot_line)) \
  || fail 'prepare recovery authority/trap is not sealed before migration and slot start'

# A state-save crash after one retired tag is removed must be replayable from
# exact tag+image-ID ownership. Container-referenced image IDs fail closed.
(
  set -euo pipefail
  eval "$(extract_function persist_current_state)"
  eval "$(extract_function run_scoped_image_tag)"
  eval "$(extract_function retired_image_absent)"
  eval "$(extract_function cleanup_retired_images)"
  DRY_RUN=0
  retired_sha="$(printf 'a%.0s' {1..40})"
  RETIRED_API_IMAGE="registry/api:${retired_sha}-0123456789ab-$(printf 'b%.0s' {1..64})"
  RETIRED_WEB_IMAGE="registry/web:${retired_sha}-0123456789ab-$(printf 'b%.0s' {1..64})"
  RETIRED_API_IMAGE_ID="sha256:$(printf '1%.0s' {1..64})"
  RETIRED_WEB_IMAGE_ID="sha256:$(printf '2%.0s' {1..64})"
  BLUE_API_IMAGE=registry/api:current; BLUE_WEB_IMAGE=registry/web:current
  GREEN_API_IMAGE=registry/api:next; GREEN_WEB_IMAGE=registry/web:next
  ACTIVE_SLOT=blue; CANDIDATE_SLOT=''; PREVIOUS_SLOT=''
  GATEWAY_MODE=application; GATEWAY_SLOT=blue; STABLE_UNTIL=''
  MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  IMAGE_DIR="$TMP/retired-image-tags"; mkdir -p "$IMAGE_DIR"
  : >"$IMAGE_DIR/api"; : >"$IMAGE_DIR/web"
  BLOCKING_CONTAINER=0; LOST_REMOVE=1; SAVE_COUNT=0
  state_get() { [[ "$1" == event ]] && printf 'preparing\n' || :; }
  state_save() { SAVE_COUNT=$((SAVE_COUNT + 1)); }
  docker() {
    if [[ "${1:-} ${2:-}" == 'ps -aq' ]]; then
      ((BLOCKING_CONTAINER == 0)) || printf 'blocking-container\n'
      return 0
    fi
    if [[ "$1" == inspect ]]; then
      [[ "${!#}" == blocking-container ]] || return 1
      printf '%s\n' "$RETIRED_API_IMAGE_ID"
      return 0
    fi
    if [[ "${1:-} ${2:-}" == 'image inspect' ]]; then
      local image="${!#}" kind
      [[ "$image" == "$RETIRED_API_IMAGE" ]] && kind=api || kind=web
      [[ -e "$IMAGE_DIR/$kind" ]] || return 1
      [[ "${3:-}" == -f ]] && { [[ "$kind" == api ]] && printf '%s\n' "$RETIRED_API_IMAGE_ID" || printf '%s\n' "$RETIRED_WEB_IMAGE_ID"; }
      return 0
    fi
    if [[ "${1:-} ${2:-}" == 'image rm' ]]; then
      local image="${3:-}" kind
      [[ "$image" == "$RETIRED_API_IMAGE" ]] && kind=api || kind=web
      command rm -f "$IMAGE_DIR/$kind"
      if ((LOST_REMOVE == 1)); then LOST_REMOVE=0; return 23; fi
      return 0
    fi
    [[ "${1:-}" == info ]]
  }
  cleanup_retired_images || fail 'lost retired-tag rm response was not replayable'
  [[ "$SAVE_COUNT" -eq 1 && -z "$RETIRED_API_IMAGE" && -z "$RETIRED_WEB_IMAGE" ]] \
    || fail 'retired image ownership was not durably cleared'

  RETIRED_API_IMAGE="registry/api:${retired_sha}-0123456789ab-$(printf 'c%.0s' {1..64})"
  RETIRED_WEB_IMAGE="registry/web:${retired_sha}-0123456789ab-$(printf 'c%.0s' {1..64})"
  RETIRED_API_IMAGE_ID="sha256:$(printf '1%.0s' {1..64})"
  RETIRED_WEB_IMAGE_ID="sha256:$(printf '2%.0s' {1..64})"
  : >"$IMAGE_DIR/api"; : >"$IMAGE_DIR/web"; BLOCKING_CONTAINER=1
  if cleanup_retired_images; then
    fail 'container-referenced retired image ID was deleted'
  fi
  [[ -e "$IMAGE_DIR/api" && -e "$IMAGE_DIR/web" ]] \
    || fail 'failed retired-tag preflight mutated image ownership'
)

STATE_REWRITE="$TMP/state-rewrite.json"
env "${common[@]}" PI5_BLUE_GREEN_STATE_FILE="$STATE_REWRITE" "$SCRIPT" bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image "$OLD_API" --web-image "$OLD_WEB" >/dev/null
grep -Fq 'refusing compose up (possible rewritten state)' <<<"$ALL_SOURCE" || fail "reconcile identity guard is missing"
grep -Fq 'legacy_compose_restore' <<<"$ALL_SOURCE" || fail "legacy restore does not use captured images"
grep -Fq 'ensure_gateway_maintenance' <<<"$ALL_SOURCE" || fail "bootstrap failure path lacks gateway maintenance retention"
grep -Fq 'spawn_stability_monitor' <<<"$ALL_SOURCE" || fail "reboot/reconcile monitor resume helper is missing"
switch_body="$(extract_function switch_candidate)"
monitor_body="$(extract_function monitor)"
if grep -Fq 'rollback_internal' <<<"$switch_body"; then
  fail "switch executor still decides rollback internally"
fi
if grep -Fq 'rollback_internal' <<<"$monitor_body"; then
  fail "stability monitor still decides rollback internally"
fi
grep -Fq 'switchback-required' <<<"$switch_body$monitor_body" \
  || fail "executor failures do not persist coordinator switchback evidence"
grep -Fq 'coordinator switchback is required before cleanup' <<<"$ALL_SOURCE" \
  || fail "cleanup can finalize a failed stability window without coordinator switchback"
grep -Fq 'reconcile will not finalize an unverified candidate' <<<"$ALL_SOURCE" \
  || fail "reconcile can finalize an unverified candidate after reboot"
grep -Fq 'verify_slot_runtime_config "$slot" >/dev/null && \' <<<"$ALL_SOURCE" \
  || fail "slot readiness does not use the canonical runtime configuration verifier"
grep -Fq 'runtime_config_digest="$(verify_slot_runtime_config "$ACTIVE_SLOT")"' <<<"$ALL_SOURCE" \
  || fail "status does not reuse the canonical runtime configuration verifier"
grep -Fq 'slot_structural_ready "$ACTIVE_SLOT" standby' <<<"$ALL_SOURCE" \
  || fail "prior-release cleanup lacks a structural-only readiness boundary"
grep -Fq 'verify_migration_plan' <<<"$ALL_SOURCE" || fail "migration plan verification is missing"
grep -Fq 'verify-migration' <<<"$ALL_SOURCE" || fail "sealed migration evidence is not verified"
grep -Fq 'verify-resource' <<<"$ALL_SOURCE" || fail "sealed resource evidence is not verified"
grep -Fq "'imageIds': {'api': maybe(blue_api_id), 'web': maybe(blue_web_id)}" <<<"$ALL_SOURCE" \
  || fail "Blue/Green state does not persist sealed slot image IDs"
grep -Fq 'verify_durable_release_evidence "$candidate"' <<<"$ALL_SOURCE" \
  || fail "switch does not revalidate run-scoped candidate evidence"
grep -Fq 'migration_gate_verify_applied_ledger' <<<"$ALL_SOURCE" \
  || fail "migration apply does not revalidate the complete post-apply ledger"
grep -Fq 'math.isfinite(value)' <<<"$ALL_SOURCE" \
  || fail "stability error-rate parsing does not reject non-finite values"
grep -Fq '0 <= value <= 1' <<<"$ALL_SOURCE" \
  || fail "stability error-rate parsing does not enforce a probability range"
(
  eval "$(extract_function monitor_checks)"
  STRUCTURAL_ONLY=0
  MONITOR_STRUCTURAL_SAMPLE_INTERVAL=15
  ERROR_RATE_URL=
  MIN_ERROR_SAMPLES=20
  DRY_RUN=0
  STRUCTURAL_CHECKS=0
  RUNTIME_CHECKS=0
  EXTERNAL_CHECKS=0
  slot_ready() { STRUCTURAL_CHECKS=$((STRUCTURAL_CHECKS + 1)); }
  slot_runtime_ready() { STRUCTURAL_CHECKS=$((STRUCTURAL_CHECKS + 1)); }
  scheduler_readiness() { RUNTIME_CHECKS=$((RUNTIME_CHECKS + 1)); }
  external_smoke() { EXTERNAL_CHECKS=$((EXTERNAL_CHECKS + 1)); }

  monitor_checks blue green 1 \
    || fail "first stability sample did not perform structural checks"
  [[ "$STRUCTURAL_CHECKS" -eq 2 && "$RUNTIME_CHECKS" -eq 0 && "$EXTERNAL_CHECKS" -eq 1 ]] \
    || fail "first stability sample did not use the structural contract"

  monitor_checks blue green 2 \
    || fail "ordinary stability sample did not perform runtime checks"
  [[ "$STRUCTURAL_CHECKS" -eq 2 && "$RUNTIME_CHECKS" -eq 2 && "$EXTERNAL_CHECKS" -eq 2 ]] \
    || fail "ordinary stability sample repeated structural work or skipped runtime health"

  monitor_checks blue green 16 \
    || fail "periodic structural stability sample failed"
  [[ "$STRUCTURAL_CHECKS" -eq 4 && "$RUNTIME_CHECKS" -eq 2 && "$EXTERNAL_CHECKS" -eq 3 ]] \
    || fail "30-second structural sample cadence is incorrect"

  monitor_checks blue green 17 1 \
    || fail "forced final structural stability sample failed"
  [[ "$STRUCTURAL_CHECKS" -eq 6 && "$RUNTIME_CHECKS" -eq 2 && "$EXTERNAL_CHECKS" -eq 4 ]] \
    || fail "final stability sample did not re-prove structure"
)
if grep -Fq 'migration_gate_validate' <<<"$ALL_SOURCE"; then
  fail "Blue/Green still owns a duplicate Expand-only migration gate"
fi
grep -Fq 'finished_at IS NOT NULL AND rolled_back_at IS NULL' <<<"$ALL_SOURCE" \
  || fail "migration recovery guard does not restrict checksums to completed, non-rolled-back rows"
grep -Fq 'validate-expand-only-migrations.py' "$ROOT/scripts/deploy/lib/migration-gate.sh" \
  || fail "migration recovery guard does not use the shared validator"
grep -Fq 'compose_migration run --rm --no-deps "api-${candidate}" sh -lc' <<<"$ALL_SOURCE" \
  || fail "candidate migration command does not use the privileged ephemeral boundary"
grep -Fq 'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate status' <<<"$ALL_SOURCE" \
  || fail "candidate migration status does not select dedicated migration authority"
[[ "$(grep -Fc 'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate status' <<<"$ALL_SOURCE")" -eq 1 ]] \
  || fail "candidate migration flow must run status only after migrate deploy"
grep -Fq 'legacy_caddy_config_path()' <<<"$ALL_SOURCE" \
  || fail "legacy active Caddyfile detection is missing"
grep -Fq '/srv/Caddyfile.local' <<<"$ALL_SOURCE" \
  || fail "legacy local-TLS Caddyfile path is not handled"
grep -Fq '/srv/Caddyfile.production' <<<"$ALL_SOURCE" \
  || fail "legacy production Caddyfile path is not handled"
grep -Fq 'LEGACY_MAINTENANCE_LOCAL_CONFIG' <<<"$ALL_SOURCE" \
  || fail "legacy local-TLS maintenance configuration is not selected"
grep -Fq "'caddyConfigPath': maybe(legacy_caddy_path)" <<<"$ALL_SOURCE" \
  || fail "legacy active Caddyfile path is not durable state"
grep -Fq 'caddy reload --config "$caddy_path" --adapter caddyfile' <<<"$ALL_SOURCE" \
  || fail "legacy Caddy reload does not use the captured active path"
grep -Fq 'gateway_smoke_url()' <<<"$ALL_SOURCE" \
  || fail "gateway startup smoke retry helper is missing"
grep -Fq 'PI5_BLUE_GREEN_GATEWAY_READY_RETRIES' <<<"$ALL_SOURCE" \
  || fail "gateway startup retry budget is not configurable"
grep -Fq 'GATEWAY_READY_RETRIES="${PI5_BLUE_GREEN_GATEWAY_READY_RETRIES:-60}"' <<<"$ALL_SOURCE" \
  || fail "gateway startup retry budget does not cover Pi5 port handoff"
grep -Fq 'for attempt in $(seq 1 "$GATEWAY_READY_RETRIES")' <<<"$ALL_SOURCE" \
  || fail "gateway startup smoke does not retry before rollback"
grep -Fq 'docker rm "$LEGACY_WEB_ID"' <<<"$ALL_SOURCE" \
  || fail "legacy Web container is not removed before gateway port handoff"
grep -Fq 'compose_current up -d --force-recreate gateway' <<<"$ALL_SOURCE" \
  || fail "gateway restart can reuse a stale port publication container"

PROD_ENV="$TMP/production.env"
printf '%s\n' \
  'ADMIN_ALLOW_NETS=127.0.0.1/32' \
  'JWT_ACCESS_SECRET=production-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz' \
  'JWT_REFRESH_SECRET=production-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz' \
  'APP_DATABASE_URL=postgresql://raspi_app:contract-app-password@db:5432/borrow_return' \
  'POSTGRES_SUPERUSER_PASSWORD_FILE=/tmp/raspi-contract-postgres-password' \
  'MIGRATION_DATABASE_ENV_FILE=/tmp/raspi-contract-migration.env' >"$PROD_ENV"
# Compose v2 auto-loads infrastructure/docker/.env; keep a non-secret stub for local/CI.
if [[ ! -f "$DOCKER_ENV_STUB" ]]; then
  cp "$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env" "$DOCKER_ENV_STUB"
  CREATED_DOCKER_ENV_STUB=1
fi
rendered="$(PI5_BLUE_API_IMAGE="$OLD_API" PI5_GREEN_API_IMAGE="$NEW_API" \
  PI5_BLUE_WEB_IMAGE="$OLD_WEB" PI5_GREEN_WEB_IMAGE="$NEW_WEB" PI5_GATEWAY_IMAGE="$NEW_WEB" \
  PI5_PROJECT_DIR="$ROOT" PI5_ENV_FILE="$PROD_ENV" docker compose --env-file "$PROD_ENV" \
  -f "$ROOT/infrastructure/docker/docker-compose.phase3.yml" config)"
assert_contains "$rendered" 'JWT_ACCESS_SECRET: production-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
assert_contains "$rendered" 'JWT_REFRESH_SECRET: production-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
[[ "$(grep -c 'restart: unless-stopped' <<<"$rendered")" -eq 5 ]] || fail "all Phase 3 services must use unless-stopped"
[[ "$(grep -c 'cpu_shares: 4096' <<<"$rendered")" -eq 2 ]] \
  || fail "both Phase 3 API slots must retain production CPU priority"
[[ "$(grep -c 'cpu_shares: 2048' <<<"$rendered")" -eq 3 ]] \
  || fail "both Web slots and the gateway must retain request-serving CPU priority"

legacy_restore_cfg="$(PI5_LEGACY_API_IMAGE="$OLD_API" PI5_LEGACY_WEB_IMAGE="$OLD_WEB" \
  PI5_PROJECT_DIR="$ROOT" PI5_ENV_FILE="$PROD_ENV" \
  docker compose --env-file "$PROD_ENV" -f "$ROOT/infrastructure/docker/docker-compose.server.yml" \
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
grep -Fq 'restore_legacy_after_phase3_stop' <<<"$ALL_SOURCE" || fail "legacy restore does not release gateway ports first"
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

grep -Fq 'ansible-update-bluegreen-' <<<"$ALL_SOURCE" || fail "Blue/Green alerts do not use the deploy-alert routing prefix"
grep -Fq "'acknowledged': False" <<<"$ALL_SOURCE" || fail "Blue/Green alert payload is missing acknowledgement state"
grep -Fq 'pi5-phase3-legacy-guard.sh' "$ROOT/scripts/deploy/pi5-image-deploy.sh" || fail "Phase 2 script is missing the Phase 3 legacy guard"

VALIDATOR="$ROOT/scripts/deploy/validate-expand-only-migrations.py"
MIGRATION_GATE="$ROOT/scripts/deploy/lib/migration-gate.sh"
grep -Fq 'load_candidate_migrations' "$VALIDATOR" \
  || fail "migration validator does not enumerate the candidate commit ledger"
grep -Fq 'migration_applied_checksums "$candidate" >"$ledger"' <<<"$ALL_SOURCE" \
  || fail "Blue/Green does not recheck the planned migration ledger before apply"

GATE_REPO="$TMP/migration-gate-repo"
git init -q "$GATE_REPO"
git -C "$GATE_REPO" config user.name 'Migration Gate Test'
git -C "$GATE_REPO" config user.email 'migration-gate@example.invalid'
GATE_MIGRATION_NAME='20260714000000_zero_new'
GATE_MIGRATION="$GATE_REPO/apps/api/prisma/migrations/$GATE_MIGRATION_NAME/migration.sql"
mkdir -p "$(dirname "$GATE_MIGRATION")" "$GATE_REPO/scripts/deploy"
printf '%s\n' 'ALTER TABLE "Example" ADD COLUMN "note" TEXT;' >"$GATE_MIGRATION"
printf '%s\n' 'provider = "postgresql"' >"$GATE_REPO/apps/api/prisma/migrations/migration_lock.toml"
git -C "$GATE_REPO" add apps/api/prisma/migrations
git -C "$GATE_REPO" commit -qm 'migration gate fixture'
GATE_COMMIT="$(git -C "$GATE_REPO" rev-parse HEAD)"
GATE_CHECKSUM="$(python3 - "$GATE_MIGRATION" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
cp "$VALIDATOR" "$GATE_REPO/scripts/deploy/validate-expand-only-migrations.py"
# shellcheck source=../lib/migration-gate.sh
source "$MIGRATION_GATE"
ledger_for_zero_new() { printf '%s|%s\n' "$GATE_MIGRATION_NAME" "$GATE_CHECKSUM"; }
ledger_empty() { :; }
ledger_failure() { return 23; }
ledger_missing() { printf '%s|%064d\n' '20260714000000_missing' 0; }
ledger_mismatch() { printf '%s|%064d\n' "$GATE_MIGRATION_NAME" 0; }
GATE_TMPDIR="$TMP/migration-gate-tmp"
mkdir -p "$GATE_TMPDIR"
assert_gate_temp_empty() {
  [[ -z "$(find "$GATE_TMPDIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
    || fail "migration gate left a ledger snapshot behind"
}

TMPDIR="$GATE_TMPDIR" migration_gate_validate \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" ledger_for_zero_new >/dev/null \
  || fail "zero-new guard path did not verify the complete applied ledger"
assert_gate_temp_empty
printf '%s\n' 'DROP TABLE "Example";' >"$GATE_MIGRATION"
TMPDIR="$GATE_TMPDIR" migration_gate_validate \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" ledger_empty >/dev/null \
  || fail "migration guard trusted dirty worktree bytes instead of the candidate commit"
assert_gate_temp_empty
if TMPDIR="$GATE_TMPDIR" migration_gate_validate \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" ledger_failure >/dev/null 2>&1; then
  fail "migration guard accepted a failed applied-ledger query"
fi
assert_gate_temp_empty
if TMPDIR="$GATE_TMPDIR" migration_gate_validate \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" ledger_missing >/dev/null 2>&1; then
  fail "zero-new migration guard accepted a missing applied migration"
fi
assert_gate_temp_empty
if TMPDIR="$GATE_TMPDIR" migration_gate_validate \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" ledger_mismatch >/dev/null 2>&1; then
  fail "zero-new migration guard accepted an applied checksum mismatch"
fi
assert_gate_temp_empty

ledger_for_zero_new >"$GATE_TMPDIR/applied.txt"
migration_gate_verify_applied_ledger \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" "$GATE_TMPDIR/applied.txt" >/dev/null \
  || fail "post-apply migration guard rejected the complete candidate ledger"
ledger_empty >"$GATE_TMPDIR/missing-after-apply.txt"
if migration_gate_verify_applied_ledger \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" "$GATE_TMPDIR/missing-after-apply.txt" >/dev/null 2>&1; then
  fail "post-apply migration guard accepted an unapplied candidate migration"
fi
ledger_mismatch >"$GATE_TMPDIR/mismatch-after-apply.txt"
if migration_gate_verify_applied_ledger \
  "$GATE_REPO" "$GATE_COMMIT" "$GATE_COMMIT" "$GATE_TMPDIR/mismatch-after-apply.txt" >/dev/null 2>&1; then
  fail "post-apply migration guard accepted a checksum mismatch"
fi

# Legacy removal is a two-step durable transaction. Simulate SIGKILL by making
# state_save fail after each successful rm, reset in-memory flags from the last
# durable snapshot, then prove the retry accepts the missing immutable ID and
# completes without wedging.
(
  set -euo pipefail
  eval "$(extract_function legacy_container_absent)"
  eval "$(extract_function persist_legacy_cleanup_progress)"
  eval "$(extract_function remove_legacy_container_once)"
  eval "$(extract_function cleanup_legacy)"
  CONTAINERS="$TMP/legacy-cleanup-containers"
  SAVES="$TMP/legacy-cleanup-saves"
  mkdir -p "$CONTAINERS"
  : >"$SAVES"
  DRY_RUN=0
  LEGACY_API_ID=legacy-api-id; LEGACY_WEB_ID=legacy-web-id
  ACTIVE_SLOT=green; CANDIDATE_SLOT=blue; PREVIOUS_SLOT=blue
  BLUE_API_IMAGE=api:blue; BLUE_WEB_IMAGE=web:blue
  GREEN_API_IMAGE=api:green; GREEN_WEB_IMAGE=web:green
  GATEWAY_MODE=application; GATEWAY_SLOT=green; STABLE_UNTIL=''
  MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  SAVE_COUNT=0; FAIL_SAVE_AT=0; LOST_RM_ID=''

  state_get() { [[ "$1" == event ]] && printf 'cleanup-handoff\n' || :; }
  state_save() {
    SAVE_COUNT=$((SAVE_COUNT + 1))
    ((FAIL_SAVE_AT == SAVE_COUNT)) && return 1
    printf '%s|%s\n' "$LEGACY_API_REMOVED" "$LEGACY_WEB_REMOVED" >>"$SAVES"
  }
  docker() {
    local operation="${1:-}" id="${2:-}"
    case "$operation" in
      inspect) [[ -e "$CONTAINERS/$id" ]] ;;
      info) return 0 ;;
      rm)
        command rm -f "$CONTAINERS/$id"
        if [[ "$LOST_RM_ID" == "$id" ]]; then LOST_RM_ID=''; return 23; fi
        ;;
      *) return 2 ;;
    esac
  }
  reset_containers() {
    command rm -rf "$CONTAINERS"; mkdir -p "$CONTAINERS"
    : >"$CONTAINERS/$LEGACY_API_ID"; : >"$CONTAINERS/$LEGACY_WEB_ID"
    : >"$SAVES"; SAVE_COUNT=0; LEGACY_API_REMOVED=0; LEGACY_WEB_REMOVED=0
  }

  reset_containers; FAIL_SAVE_AT=1
  if cleanup_legacy; then fail 'API rm crash boundary unexpectedly completed'; fi
  [[ ! -e "$CONTAINERS/$LEGACY_API_ID" && -e "$CONTAINERS/$LEGACY_WEB_ID" ]] \
    || fail 'API rm crash fixture did not stop at the first boundary'
  LEGACY_API_REMOVED=0; LEGACY_WEB_REMOVED=0; FAIL_SAVE_AT=0
  cleanup_legacy || fail 'retry wedged after API rm succeeded before state_save'
  [[ "$(tail -n 1 "$SAVES")" == '1|1' ]] \
    || fail 'API rm retry did not durably complete both removals'

  reset_containers; FAIL_SAVE_AT=2
  if cleanup_legacy; then fail 'Web rm crash boundary unexpectedly completed'; fi
  [[ ! -e "$CONTAINERS/$LEGACY_API_ID" && ! -e "$CONTAINERS/$LEGACY_WEB_ID" ]] \
    || fail 'Web rm crash fixture did not remove both containers'
  IFS='|' read -r LEGACY_API_REMOVED LEGACY_WEB_REMOVED < <(tail -n 1 "$SAVES")
  [[ "$LEGACY_API_REMOVED|$LEGACY_WEB_REMOVED" == '1|0' ]] \
    || fail 'Web rm crash fixture persisted the wrong boundary'
  FAIL_SAVE_AT=0
  cleanup_legacy || fail 'retry wedged after Web rm succeeded before state_save'
  [[ "$(tail -n 1 "$SAVES")" == '1|1' ]] \
    || fail 'Web rm retry was not durably completed'

  reset_containers; LOST_RM_ID="$LEGACY_API_ID"
  cleanup_legacy || fail 'lost successful docker rm response was not resolved from live absence'
  [[ "$(tail -n 1 "$SAVES")" == '1|1' ]] \
    || fail 'lost rm response did not produce complete durable cleanup state'
)

echo "PASS: pi5 blue/green safety lifecycle"
