#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-image-deploy.sh"
TMP="$(mktemp -d)"
LOCK_HOLDER_PID=""
DOCKER_ENV_STUB="$ROOT/infrastructure/docker/.env"
CREATED_DOCKER_ENV_STUB=0
cleanup() {
  if [[ -n "$LOCK_HOLDER_PID" ]]; then
    kill "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
    wait "$LOCK_HOLDER_PID" 2>/dev/null || true
  fi
  if [[ "$CREATED_DOCKER_ENV_STUB" -eq 1 ]]; then
    rm -f "$DOCKER_ENV_STUB"
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

# Compose resolves service env_file entries even though only the sanitized
# build.args projection is hashed. Production always has this file; provide the
# deterministic fixture for hosted lifecycle tests.
if [[ ! -f "$DOCKER_ENV_STUB" ]]; then
  cp "$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env" "$DOCKER_ENV_STUB"
  CREATED_DOCKER_ENV_STUB=1
fi

sha="$(git -C "$ROOT" rev-parse HEAD)"
output="$(env "${common_env[@]}" "$SCRIPT" prepare --ref "$sha" --run-id run-image-test \
  --resource-evidence "$TMP/resource-evidence.json")"
assert_contains "$output" "candidate prepared"
assert_contains "$output" "VITE_RELEASE_SHA=$sha"
[[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["event"])' "$TMP/state.json")" == prepared ]] || fail "state is not prepared"
[[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runId"])' "$TMP/state.json")" == run-image-test ]] || fail "state is not bound to the run"
[[ -s "$TMP/resource-evidence.json" ]] || fail "resource evidence was not written"

# Runtime-only secrets must not change the sealed build-argument component.
# The final tag is nevertheless run-scoped so a later run cannot retarget an
# image reference retained by an active or rollback Blue/Green slot.
SECRET_ENV_A="$TMP/secret-a.env"
SECRET_ENV_B="$TMP/secret-b.env"
cp "$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env" "$SECRET_ENV_A"
sed 's/production-access-secret/rotated-production-access-secret/' "$SECRET_ENV_A" >"$SECRET_ENV_B"
env "${common_env[@]}" PI5_ENV_FILE="$SECRET_ENV_A" PI5_DEPLOY_STATE_FILE="$TMP/secret-a-state.json" \
  PI5_DEPLOY_LOCK_FILE="$TMP/secret-a-lock" "$SCRIPT" prepare --ref "$sha" --run-id run-secret-a \
  --resource-evidence "$TMP/secret-a-evidence.json" >/dev/null
env "${common_env[@]}" PI5_ENV_FILE="$SECRET_ENV_B" PI5_DEPLOY_STATE_FILE="$TMP/secret-b-state.json" \
  PI5_DEPLOY_LOCK_FILE="$TMP/secret-b-lock" "$SCRIPT" prepare --ref "$sha" --run-id run-secret-b \
  --resource-evidence "$TMP/secret-b-evidence.json" >/dev/null
secret_tag_a="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["candidate"]["api"])' "$TMP/secret-a-state.json")"
secret_tag_b="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["candidate"]["api"])' "$TMP/secret-b-state.json")"
[[ "$secret_tag_a" != "$secret_tag_b" ]] || fail "separate runs reused one candidate image tag"
config_component_a="$(sed -E "s|^.*:${sha}-([0-9a-f]{12})-[0-9a-f]{64}$|\\1|" <<<"$secret_tag_a")"
config_component_b="$(sed -E "s|^.*:${sha}-([0-9a-f]{12})-[0-9a-f]{64}$|\\1|" <<<"$secret_tag_b")"
[[ "$config_component_a" =~ ^[0-9a-f]{12}$ \
  && "$config_component_a" == "$config_component_b" ]] \
  || fail "runtime secret rotation changed the sealed build-argument digest"

# A Compose/.env build-argument change between sealing and the pre-build gate
# must abort. The stub changes INSTALL_PLAYWRIGHT_CHROMIUM on its second config.
DRIFT_BIN="$TMP/drift-bin"
mkdir -p "$DRIFT_BIN"
cat >"$DRIFT_BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
count=0
[[ ! -f "${DRIFT_COUNT_FILE:?}" ]] || count="$(cat "$DRIFT_COUNT_FILE")"
count=$((count + 1)); printf '%s\n' "$count" >"$DRIFT_COUNT_FILE"
playwright=true
((count == 1)) || playwright=false
python3 - "$playwright" "${VITE_RELEASE_SHA:?}" <<'PY'
import json, sys
playwright, release = sys.argv[1:]
print(json.dumps({'services': {
  'api': {'build': {'args': {'INSTALL_PLAYWRIGHT_CHROMIUM': playwright}}},
  'web': {'build': {'args': {
    'VITE_AGENT_WS_URL': 'ws://localhost:7071/stream',
    'VITE_API_BASE_URL': '/api',
    'VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED': 'true',
    'VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED': 'false',
    'VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED': 'false',
    'VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED': 'false',
    'VITE_RELEASE_SHA': release,
  }}},
}}))
PY
SH
chmod +x "$DRIFT_BIN/docker"
if env "${common_env[@]}" PATH="$DRIFT_BIN:$PATH" DRIFT_COUNT_FILE="$TMP/drift-count" \
  PI5_DEPLOY_STATE_FILE="$TMP/drift-state.json" PI5_DEPLOY_LOCK_FILE="$TMP/drift-lock" \
  "$SCRIPT" prepare --ref "$sha" --run-id run-build-drift \
  --resource-evidence "$TMP/drift-evidence.json" >/dev/null 2>&1; then
  fail "candidate build accepted effective build-argument drift after sealing"
fi
[[ ! -f "$TMP/drift-state.json" ]] \
  || [[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("event"))' "$TMP/drift-state.json")" == failed ]] \
  || fail "build-argument drift left prepared candidate state"

# The exact validation container remains cleanup-owned until removal succeeds
# or Docker explicitly proves it absent. A transient first rm must be retried.
(
  eval "$(sed -n '/^candidate_container_absent() {/,/^candidate_validation_metadata() {/p' "$SCRIPT" | sed '$d')"
  CANDIDATE_CONTAINER_ID="$(printf 'a%.0s' {1..64})"
  REMOVE_ATTEMPTS=0
  CONTAINER_EXISTS=1
  docker() {
    if [[ "$1" == rm ]]; then
      REMOVE_ATTEMPTS=$((REMOVE_ATTEMPTS + 1))
      if ((REMOVE_ATTEMPTS > 1)); then CONTAINER_EXISTS=0; return 0; fi
      return 1
    fi
    if [[ "$1" == container && "$2" == inspect ]]; then
      ((CONTAINER_EXISTS == 1))
      return
    fi
    if [[ "$1" == info ]]; then return 0; fi
    return 0
  }
  sleep() { :; }
  log() { :; }
  remove_candidate_validation_container || fail "candidate cleanup did not retry transient rm failure"
  [[ "$REMOVE_ATTEMPTS" -eq 2 ]] || fail "candidate cleanup retry count is incorrect"
  [[ -z "$CANDIDATE_CONTAINER_ID" ]] || fail "candidate cleanup retained a removed container ID"
)

# The rendered sealed-argument artifact is globally cleanup-owned while it is
# being decoded. Bash runs the EXIT trap for terminating signals, so an
# interrupted prepare must not leave the 0600 artifact behind.
RENDER_RESIDUE="$TMP/sealed-build-args-rendered"
printf 'temporary sealed rendering\n' >"$RENDER_RESIDUE"
chmod 600 "$RENDER_RESIDUE"
set +e
bash -c '
  set -euo pipefail
  script="$1" residue="$2"
  eval "$(sed -n '\''/^image_deploy_cleanup() {/,/^}/p'\'' "$script")"
  DRY_RUN=1
  CANDIDATE_CONTAINER_ID=""
  PREPARE_ACTIVE=0
  BUILD_CONTEXT=""
  BUILD_OVERRIDE=""
  BUILD_ARGS_FILE=""
  BUILD_ARGS_RENDER_FILE="$residue"
  LOCK_DIR=""
  LOCK_DIR_ACQUIRED=0
  resume_signage() { return 0; }
  trap '\''exit 143'\'' TERM
  trap image_deploy_cleanup EXIT
  kill -TERM $$
  sleep 1
' bash "$SCRIPT" "$RENDER_RESIDUE" >/dev/null 2>&1
render_signal_rc=$?
set -e
[[ "$render_signal_rc" -eq 143 ]] || fail "signal cleanup returned unexpected status: $render_signal_rc"
[[ ! -e "$RENDER_RESIDUE" ]] || fail "signal cleanup left sealed build-argument rendering behind"

# Workload-control ownership is response-driven. A runtime that intentionally
# disables signage acknowledges pause as a safe no-op and must never receive a
# resume request. HTTP fallback is limited to an exact 404 status marker from
# an unlabeled pre-endpoint API; a 500 body merely mentioning 404 must fail.
(
  eval "$(sed -n '/^record_signage_event() {/,/^}/p' "$SCRIPT")"
  eval "$(sed -n '/^set_signage_state() {/,/^pause_signage() {/p' "$SCRIPT" | sed '$d')"
  eval "$(sed -n '/^pause_signage() {/,/^}/p' "$SCRIPT")"
  eval "$(sed -n '/^resume_signage() {/,/^}/p' "$SCRIPT")"
  DRY_RUN=0
  SIGNAGE_CONTAINER_ID=candidate-api
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_PAUSED=0
  SIGNAGE_RESUME_REQUIRED=""
  write_signage_pause_owner() { :; }
  clear_signage_pause_owner() { :; }
  CONTROL_CALL_LOG="$TMP/workload-control-calls"
  CONTROL_MODE=disabled
  : >"$CONTROL_CALL_LOG"
  docker() {
    if [[ "$1" == exec ]]; then
      printf '%s\n' "$*" >>"$CONTROL_CALL_LOG"
      case "$CONTROL_MODE" in
        disabled)
          printf '%s\n' '{"action":"pause-signage","enabled":false,"resumeRequired":false,"signage":{"isRunning":false}}'
          return 0
          ;;
        legacy-enabled)
          if [[ "${!#}" == pause-signage ]]; then
            printf '%s\n' '{"action":"pause-signage","signage":{"isRunning":false}}'
          else
            printf '%s\n' '{"action":"resume-signage","signage":{"isRunning":true}}'
          fi
          return 0
          ;;
        legacy-wrong-state)
          if [[ "${!#}" == pause-signage ]]; then
            printf '%s\n' '{"action":"pause-signage","signage":{"isRunning":true}}'
          else
            printf '%s\n' '{"action":"resume-signage","signage":{"isRunning":false}}'
          fi
          return 0
          ;;
        http-500)
          printf '%s\n%s\n' 'DEPLOY_WORKLOAD_HTTP_STATUS=500' '{"message":"legacy route returned 404 upstream"}'
          return 1
          ;;
        http-404)
          printf '%s\n%s\n' 'DEPLOY_WORKLOAD_HTTP_STATUS=404' '{"message":"route not found"}'
          return 1
          ;;
        resume-retry)
          local calls
          calls="$(wc -l <"$CONTROL_CALL_LOG" | tr -d ' ')"
          if ((calls == 1)); then
            printf '%s\n%s\n' 'DEPLOY_WORKLOAD_HTTP_STATUS=503' '{"message":"temporary failure"}'
            return 1
          fi
          printf '%s\n' '{"action":"resume-signage","enabled":true,"resumeRequired":false,"signage":{"isRunning":true}}'
          return 0
          ;;
      esac
    fi
    if [[ "$1" == inspect ]]; then
      # Empty revision label identifies only the pre-endpoint legacy API.
      printf '\n'
      return 0
    fi
    return 1
  }
  sleep() { :; }
  log() { :; }
  die() { fail "$*"; }

  pause_signage
  [[ "$SIGNAGE_PAUSED" -eq 0 ]] || fail "disabled signage retained resume ownership"
  grep -Fxq 'exec -i candidate-api node - pause-signage' "$CONTROL_CALL_LOG" \
    || fail "workload control did not keep docker exec stdin attached"
  resume_signage
  [[ "$(wc -l <"$CONTROL_CALL_LOG" | tr -d ' ')" -eq 1 ]] \
    || fail "disabled signage received an unnecessary resume request"

  CONTROL_MODE=legacy-enabled
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_PAUSED=0
  SIGNAGE_RESUME_REQUIRED=""
  : >"$CONTROL_CALL_LOG"
  pause_signage \
    || fail "verified legacy pause response was rejected"
  [[ "$SIGNAGE_PAUSED" -eq 1 && "$SIGNAGE_RESUME_REQUIRED" == 1 ]] \
    || fail "legacy pause did not retain conservative resume ownership"
  resume_signage \
    || fail "verified legacy resume response was rejected"
  [[ "$SIGNAGE_PAUSED" -eq 0 && "$SIGNAGE_RESUME_REQUIRED" == 0 ]] \
    || fail "legacy resume did not clear pause ownership"
  [[ "$(wc -l <"$CONTROL_CALL_LOG" | tr -d ' ')" -eq 2 ]] \
    || fail "legacy workload control did not make one pause and one resume request"

  CONTROL_MODE=legacy-wrong-state
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_RESUME_REQUIRED=""
  : >"$CONTROL_CALL_LOG"
  if set_signage_state pause-signage >/dev/null 2>&1; then
    fail "legacy pause response with a running scheduler was accepted"
  fi
  if set_signage_state resume-signage >/dev/null 2>&1; then
    fail "legacy resume response with a stopped scheduler was accepted"
  fi

  CONTROL_MODE=http-500
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_RESUME_REQUIRED=""
  : >"$CONTROL_CALL_LOG"
  if set_signage_state pause-signage >/dev/null 2>&1; then
    fail "HTTP 500 body mentioning 404 was accepted as legacy fallback"
  fi
  [[ "$SIGNAGE_CONTROL_EVENTS" != *'"state":"legacy-api-unavailable"'* ]] \
    || fail "non-404 workload failure was recorded as legacy fallback"

  CONTROL_MODE=http-404
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_RESUME_REQUIRED=""
  : >"$CONTROL_CALL_LOG"
  set_signage_state pause-signage \
    || fail "exact 404 from an unlabeled legacy API did not use bounded fallback"
  [[ "$SIGNAGE_RESUME_REQUIRED" == 0 ]] \
    || fail "legacy fallback retained resume ownership"

  # A hard kill can leave a durable owner after the same verified pause no-op.
  # Takeover uses resume; the exact unlabeled legacy 404 must also be a no-op
  # so ownership can be durably cleared instead of wedging every later run.
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_PAUSED=1
  SIGNAGE_RESUME_REQUIRED=1
  : >"$CONTROL_CALL_LOG"
  resume_signage \
    || fail "resume 404 from an unlabeled legacy API did not verify as a no-op"
  [[ "$SIGNAGE_PAUSED" -eq 0 && "$SIGNAGE_RESUME_REQUIRED" == 0 ]] \
    || fail "verified legacy resume no-op retained cleanup ownership"

  CONTROL_MODE=resume-retry
  SIGNAGE_CONTROL_EVENTS='[]'
  SIGNAGE_PAUSED=1
  SIGNAGE_RESUME_REQUIRED=1
  : >"$CONTROL_CALL_LOG"
  resume_signage 2>/dev/null || fail "resume did not retry a transient workload-control failure"
  [[ "$(wc -l <"$CONTROL_CALL_LOG" | tr -d ' ')" -eq 2 ]] \
    || fail "resume retry did not make exactly two attempts"
  [[ "$SIGNAGE_PAUSED" -eq 0 ]] || fail "successful resume retained cleanup ownership"

  # A lost/transport response may have paused the remote worker. Keep cleanup
  # ownership even when both the pause and immediate resume attempts fail.
  TRANSPORT_CALL_LOG="$TMP/workload-control-transport-calls"
  : >"$TRANSPORT_CALL_LOG"
  set +e
  (
    SIGNAGE_PAUSED=0
    SIGNAGE_RESUME_REQUIRED=""
    set_signage_state() {
      printf '%s\n' "$1" >>"$TRANSPORT_CALL_LOG"
      return 1
    }
    die() {
      [[ "$SIGNAGE_PAUSED" -eq 1 ]] || exit 90
      exit 42
    }
    pause_signage
  )
  transport_rc=$?
  set -e
  [[ "$transport_rc" -eq 42 ]] \
    || fail "uncertain pause response did not retain cleanup ownership"
  [[ "$(sed -n '1p' "$TRANSPORT_CALL_LOG")" == pause-signage \
    && "$(sed -n '2p' "$TRANSPORT_CALL_LOG")" == resume-signage ]] \
    || fail "uncertain pause did not make an immediate compensating resume attempt"
)

# A hard kill bypasses EXIT traps. The pause owner must therefore exist before
# the remote request and a later takeover must issue an idempotent resume before
# any planning/reuse path, then durably clear ownership.
(
  eval "$(sed -n '/^write_signage_pause_owner() {/,/^record_signage_event() {/p' "$SCRIPT" | sed '$d')"
  eval "$(sed -n '/^resume_signage() {/,/^}/p' "$SCRIPT")"
  DRY_RUN=0
  SIGNAGE_PAUSE_OWNER_FILE="$TMP/hard-kill-signage-owner.json"
  RUN_ID=run-hard-kill-owner
  REF="$sha"
  SIGNAGE_PAUSED=0
  SIGNAGE_RESUME_REQUIRED=""
  SIGNAGE_CONTAINER_ID=""
  RESUME_CALLS=0
  record_signage_event() { :; }
  log() { :; }
  sleep() { :; }
  die() { fail "$*"; }
  set_signage_state() {
    [[ "$1" == resume-signage ]] || return 1
    RESUME_CALLS=$((RESUME_CALLS + 1))
    SIGNAGE_RESUME_REQUIRED=0
    return 0
  }

  write_signage_pause_owner
  [[ -s "$SIGNAGE_PAUSE_OWNER_FILE" ]] \
    || fail 'pause owner was not durable before the simulated hard kill'
  # Simulated new process: all in-memory ownership is lost.
  SIGNAGE_PAUSED=0; SIGNAGE_RESUME_REQUIRED=""; SIGNAGE_CONTAINER_ID=""
  reconcile_signage_pause_owner
  [[ "$RESUME_CALLS" -eq 1 && ! -e "$SIGNAGE_PAUSE_OWNER_FILE" ]] \
    || fail 'takeover did not resume and clear hard-killed signage ownership'

  printf '%s\n' '{"version":1,"state":"resume-required"}' >"$SIGNAGE_PAUSE_OWNER_FILE"
  if (reconcile_signage_pause_owner >/dev/null 2>&1); then
    fail 'malformed durable pause ownership was accepted'
  fi
)

# Candidate validation containers use deterministic run labels. Simulate a
# hard-killed owner and a lost successful rm response; takeover must discover
# the exact container and prove it absent. Also prove a lost create response is
# resolved from its deterministic name and labels.
(
  eval "$(sed -n '/^candidate_container_absent() {/,/^image_deploy_cleanup() {/p' "$SCRIPT" | sed '$d')"
  DRY_RUN=0
  RUN_ID=run-validation-owner
  REF="$sha"
  CANDIDATE_CONTAINER_NAME="pi5-api-candidate-${RUN_ID}-${REF:0:12}"
  CANDIDATE_CONTAINER_ID=""
  ORPHAN_ID="$(printf 'b%.0s' {1..64})"
  CONTAINER_EXISTS=1
  LOST_REMOVE_RESPONSE=1
  log() { :; }
  sleep() { :; }
  reconcile_signage_pause_owner() { :; }
  candidate_validation_metadata() {
    [[ "$CONTAINER_EXISTS" -eq 1 ]] || return 1
    printf '%s|/%s|candidate-validation|%s|%s\n' \
      "$ORPHAN_ID" "$CANDIDATE_CONTAINER_NAME" "$RUN_ID" "$REF"
  }
  docker() {
    case "${1:-} ${2:-}" in
      'ps -aq') [[ "$CONTAINER_EXISTS" -eq 1 ]] && printf '%s\n' "$ORPHAN_ID" ;;
      'rm -f')
        CONTAINER_EXISTS=0
        if ((LOST_REMOVE_RESPONSE == 1)); then LOST_REMOVE_RESPONSE=0; return 23; fi
        ;;
      'container inspect') ((CONTAINER_EXISTS == 1)) ;;
      'info ') return 0 ;;
      *) return 2 ;;
    esac
  }

  cleanup_orphan_candidate_validation_containers \
    || fail 'hard-killed candidate validation container was not reconciled'
  [[ "$CONTAINER_EXISTS" -eq 0 && -z "$CANDIDATE_CONTAINER_ID" ]] \
    || fail 'lost rm response left candidate validation ownership active'

  CONTAINER_EXISTS=1
  discover_current_candidate_validation_container \
    || fail 'lost create response could not resolve deterministic ownership'
  [[ "$CANDIDATE_CONTAINER_ID" == "$ORPHAN_ID" ]] \
    || fail 'lost create response resolved the wrong candidate container'
)

# Built image tags are also hard-kill owned. A later run may remove only the
# exact prior run tags whose provenance/IDs match and which are absent from
# Blue/Green state and every container. Lost rm responses remain replayable.
(
  set -euo pipefail
  eval "$(sed -n '/^candidate_image_tag_absent() {/,/^reconcile_candidate_build_residue() {/p' "$SCRIPT" | sed '$d')"
  DRY_RUN=0
  STATE_FILE="$TMP/owned-candidate-state.json"
  BLUE_GREEN_STATE_FILE="$TMP/no-bluegreen-state.json"
  API_REPOSITORY=raspi-system-api; WEB_REPOSITORY=raspi-system-web
  owner=run-owned-old; RUN_ID=run-owned-new
  owned_sha="$(printf 'd%.0s' {1..40})"; REF="$(printf 'e%.0s' {1..40})"
  owner_digest="$(python3 - "$owner" <<'PY'
import hashlib,sys
print(hashlib.sha256(sys.argv[1].encode()).hexdigest())
PY
)"
  api="${API_REPOSITORY}:${owned_sha}-0123456789ab-${owner_digest}"
  web="${WEB_REPOSITORY}:${owned_sha}-0123456789ab-${owner_digest}"
  api_id="sha256:$(printf '3%.0s' {1..64})"; web_id="sha256:$(printf '4%.0s' {1..64})"
  python3 - "$STATE_FILE" "$owner" "$owned_sha" "$api" "$web" "$api_id" "$web_id" <<'PY'
import json,sys
path,owner,sha,api,web,api_id,web_id=sys.argv[1:]
json.dump({'event':'building','runId':owner,'desiredSha':sha,
           'candidate':{'api':api,'web':web,'imageIds':{'api':api_id,'web':web_id}}},
          open(path,'w'))
PY
  IMAGE_DIR="$TMP/owned-candidate-tags"; mkdir -p "$IMAGE_DIR"
  : >"$IMAGE_DIR/api"; : >"$IMAGE_DIR/web"; LOST_IMAGE_RM=1
  docker() {
    if [[ "${1:-} ${2:-}" == 'ps -aq' ]]; then return 0; fi
    if [[ "${1:-} ${2:-}" == 'image inspect' ]]; then
      local image="${!#}" kind
      [[ "$image" == "$api" ]] && kind=api || kind=web
      [[ -e "$IMAGE_DIR/$kind" ]] || return 1
      case "${4:-}" in
        '{{.Id}}') [[ "$kind" == api ]] && printf '%s\n' "$api_id" || printf '%s\n' "$web_id" ;;
        *revision*) printf '%s\n' "$owned_sha" ;;
        *config-hash*) printf '%s\n' '0123456789ab0000000000000000000000000000000000000000000000000000' ;;
      esac
      return 0
    fi
    if [[ "${1:-} ${2:-}" == 'image rm' ]]; then
      local image="${3:-}" kind
      [[ "$image" == "$api" ]] && kind=api || kind=web
      command rm -f "$IMAGE_DIR/$kind"
      if ((LOST_IMAGE_RM == 1)); then LOST_IMAGE_RM=0; return 23; fi
      return 0
    fi
    [[ "${1:-}" == info ]]
  }
  cleanup_owned_candidate_image_tags \
    || fail 'owned hard-kill candidate tags were not reconciled'
  [[ ! -e "$IMAGE_DIR/api" && ! -e "$IMAGE_DIR/web" ]] \
    || fail 'owned candidate tag cleanup was incomplete'

  : >"$IMAGE_DIR/api"; : >"$IMAGE_DIR/web"
  python3 - "$BLUE_GREEN_STATE_FILE" "$api" "$web" <<'PY'
import json,sys
json.dump({'slots':{'blue':{'images':{'api':sys.argv[2],'web':sys.argv[3]}},
                    'green':{'images':{'api':None,'web':None}}}},open(sys.argv[1],'w'))
PY
  cleanup_owned_candidate_image_tags \
    || fail 'Blue/Green-owned candidate tags blocked the next coordinator run'
  [[ -e "$IMAGE_DIR/api" && -e "$IMAGE_DIR/web" ]] \
    || fail 'Blue/Green tag exclusion mutated an active reference'

  # The first PR6 rollout encounters a legacy candidate-state record without
  # run-scoped ownership fields. The exact pair may be retained only when the
  # Blue/Green state proves that both tags remain referenced.
  python3 - "$STATE_FILE" <<'PY'
import json,sys
path=sys.argv[1]
state=json.load(open(path))
state.pop('runId', None); state.pop('desiredSha', None)
state['candidate'].pop('imageIds', None)
json.dump(state,open(path,'w'))
PY
  cleanup_owned_candidate_image_tags \
    || fail 'legacy Blue/Green-owned candidate tags blocked first takeover'
  [[ -e "$IMAGE_DIR/api" && -e "$IMAGE_DIR/web" ]] \
    || fail 'legacy Blue/Green ownership mutated an active reference'

  python3 - "$BLUE_GREEN_STATE_FILE" <<'PY'
import json,sys
json.dump({'slots':{'blue':{'images':{'api':'api:current','web':'web:current'}},
                    'green':{'images':{'api':None,'web':None}}}},open(sys.argv[1],'w'))
PY
  if cleanup_owned_candidate_image_tags; then
    fail 'unreferenced legacy candidate state was accepted'
  fi
  [[ -e "$IMAGE_DIR/api" && -e "$IMAGE_DIR/web" ]] \
    || fail 'unreferenced legacy state mutated candidate tags'

  python3 - "$STATE_FILE" "$owner" "$owned_sha" "$api" "$web" "$api_id" "$web_id" <<'PY'
import json,sys
path,owner,sha,api,web,api_id,web_id=sys.argv[1:]
json.dump({'event':'building','runId':owner,'desiredSha':sha,
           'candidate':{'api':api,'web':web,'imageIds':{'api':api_id,'web':web_id}}},
          open(path,'w'))
PY

  python3 - "$BLUE_GREEN_STATE_FILE" "$api" "$web" <<'PY'
import json,sys
json.dump({'slots':{'blue':{'images':{'api':'api:current','web':'web:current'}},
                    'green':{'images':{'api':None,'web':None}}},
           'retiredImages':{'images':{'api':sys.argv[2],'web':sys.argv[3]},
                            'imageIds':{'api':'sha256:'+'3'*64,'web':'sha256:'+'4'*64}}},
          open(sys.argv[1],'w'))
PY
  cleanup_owned_candidate_image_tags \
    || fail 'retired Phase3-owned candidate tags blocked takeover'
  [[ -e "$IMAGE_DIR/api" && -e "$IMAGE_DIR/web" ]] \
    || fail 'retired Phase3 ownership did not exclude candidate tag cleanup'

  python3 - "$BLUE_GREEN_STATE_FILE" "$api" <<'PY'
import json,sys
json.dump({'slots':{'blue':{'images':{'api':sys.argv[2],'web':'web:other'}},
                    'green':{'images':{'api':None,'web':None}}}},open(sys.argv[1],'w'))
PY
  if cleanup_owned_candidate_image_tags; then
    fail 'partial Blue/Green tag ownership was accepted'
  fi
  [[ -e "$IMAGE_DIR/api" && -e "$IMAGE_DIR/web" ]] \
    || fail 'partial Blue/Green ownership mutated candidate tags'
)

grep -Fq 'VITE_RELEASE_SHA: ${VITE_RELEASE_SHA:-}' \
  "$ROOT/infrastructure/docker/docker-compose.server.yml" \
  || fail "server Compose does not forward the immutable Web release SHA"
grep -Fq 'ARG VITE_RELEASE_SHA=' "$ROOT/infrastructure/docker/Dockerfile.web" \
  || fail "Web image does not declare the late release SHA build argument"
grep -Fq 'VITE_RELEASE_SHA="$VITE_RELEASE_SHA" pnpm run build' \
  "$ROOT/infrastructure/docker/Dockerfile.web" \
  || fail "Web image does not bind its release SHA to the Vite build"
grep -Fq 'safe_git archive --format=tar "$REF"' "$SCRIPT" \
  || fail "candidate build context is not materialized from the sealed Git commit"
grep -Fq 'BUILD_COMMIT=${REF}' "$SCRIPT" \
  || fail "candidate Docker build does not receive the immutable commit label"
grep -Fq 'LABEL org.opencontainers.image.revision=${BUILD_COMMIT}' \
  "$ROOT/infrastructure/docker/Dockerfile.api" "$ROOT/infrastructure/docker/Dockerfile.web" \
  || fail "candidate images do not seal their source revision"
python3 - \
  "$ROOT/infrastructure/docker/Dockerfile.api" \
  "$ROOT/infrastructure/docker/Dockerfile.web" <<'PY'
import pathlib
import re
import sys


def final_stage_instructions(path: pathlib.Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    stage_starts = [
        index for index, line in enumerate(lines)
        if re.match(r"^\s*FROM\s+", line, flags=re.IGNORECASE)
    ]
    if not stage_starts:
        raise AssertionError(f"{path}: Dockerfile has no FROM instruction")

    instructions: list[str] = []
    current: list[str] = []
    for raw_line in lines[stage_starts[-1]:]:
        stripped = raw_line.strip()
        if not current and (not stripped or stripped.startswith("#")):
            continue
        current.append(stripped)
        if stripped.endswith("\\"):
            continue
        instructions.append(" ".join(current))
        current = []
    if current:
        instructions.append(" ".join(current))
    return instructions


for raw_path in sys.argv[1:]:
    path = pathlib.Path(raw_path)
    instructions = final_stage_instructions(path)
    filesystem_indexes = [
        index for index, instruction in enumerate(instructions)
        if re.match(r"^(RUN|COPY|ADD)\b", instruction, flags=re.IGNORECASE)
    ]
    if not filesystem_indexes:
        raise AssertionError(f"{path}: final stage has no filesystem-producing instruction")
    last_filesystem_index = max(filesystem_indexes)

    arg_indexes: dict[str, int] = {}
    for name in ("BUILD_COMMIT", "BUILD_CONFIG_HASH"):
        matches = [
            index for index, instruction in enumerate(instructions)
            if re.match(rf"^ARG\s+{name}(?:=|\s|$)", instruction, flags=re.IGNORECASE)
        ]
        if len(matches) != 1:
            raise AssertionError(f"{path}: final stage must declare {name} exactly once")
        arg_indexes[name] = matches[0]
        if matches[0] <= last_filesystem_index:
            raise AssertionError(
                f"{path}: {name} must follow every final-stage RUN/COPY/ADD instruction"
            )

    required_labels = {
        "org.opencontainers.image.revision=${BUILD_COMMIT}": arg_indexes["BUILD_COMMIT"],
        "org.opencontainers.image.config-hash=${BUILD_CONFIG_HASH}": arg_indexes["BUILD_CONFIG_HASH"],
    }
    for label, arg_index in required_labels.items():
        matches = [
            index for index, instruction in enumerate(instructions)
            if instruction.upper().startswith("LABEL ") and label in instruction
        ]
        if len(matches) != 1 or matches[0] <= arg_index:
            raise AssertionError(
                f"{path}: provenance label {label} must occur once after its ARG"
            )
PY
grep -Fq '**/.env' "$ROOT/.dockerignore" || fail ".env files are not excluded from Docker contexts"
grep -Fq '**/__pycache__' "$ROOT/.dockerignore" || fail "Python caches are not excluded from Docker contexts"
grep -Fq '**/*.py[cod]' "$ROOT/.dockerignore" || fail "Python bytecode is not excluded from Docker contexts"
if grep -Fq 'docker exec -e "DEPLOY_CONTROL_TOKEN=' "$SCRIPT"; then
  fail "deploy credential is exposed in the host docker-exec argument list"
fi
grep -Fq 'process.env.DEPLOY_CONTROL_TOKEN || process.env.JWT_ACCESS_SECRET' "$SCRIPT" \
  || fail "host-local workload control does not use the credential already inside the API container"
grep -Fq 'CANDIDATE_CONTAINER_NAME="pi5-api-candidate-${RUN_ID}-${REF:0:12}"' "$SCRIPT" \
  || fail 'candidate validation container name is not deterministic and run-scoped'
grep -Fq 'printf '\''%s-%s-%s\n'\'' "$REF" "${config_hash:0:12}" "$run_digest"' "$SCRIPT" \
  || fail 'candidate image tag is not deterministic and run-scoped'
grep -Fq 'io.raspi-system.deploy-purpose=candidate-validation' "$SCRIPT" \
  || fail 'candidate validation container lacks an ownership label'
if grep -Eq 'pi5-api-candidate-.*\$\$' "$SCRIPT"; then
  fail 'candidate validation identity still depends on the shell PID'
fi
prepare_body="$(sed -n '/^prepare() {/,/^}/p' "$SCRIPT")"
[[ "$(grep -n 'reconcile_candidate_build_residue' <<<"$prepare_body" | cut -d: -f1)" \
  -lt "$(grep -n 'prepared_images_are_exact' <<<"$prepare_body" | cut -d: -f1)" ]] \
  || fail 'candidate residue takeover does not precede the image reuse/no-op path'
[[ "$(grep -n 'atomic_state building' <<<"$prepare_body" | cut -d: -f1)" \
  -lt "$(grep -n 'pause_signage' <<<"$prepare_body" | tail -1 | cut -d: -f1)" ]] \
  || fail 'candidate image ownership is not durable before build-side workload mutation'
[[ -s "$ROOT/apps/api/src/routes/system/deploy-workload.ts" ]] \
  || fail "host-local workload control endpoint is missing"

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

if env "${common_env[@]}" "$SCRIPT" prepare --ref short --run-id run-image-test >/dev/null 2>&1; then
  fail "short SHA was accepted"
fi

if env "${common_env[@]}" "$SCRIPT" prepare --ref "$sha" --force-destructive-migration >/dev/null 2>&1; then
  fail "removed destructive-migration bypass was accepted"
fi

# Git environment poisoning and hidden index flags must be rejected before a
# commit can be labelled as an immutable image source.
TMP_PHYSICAL="$(cd "$TMP" && pwd -P)"
STRICT_REPO="$TMP_PHYSICAL/strict-repository"
mkdir -p "$STRICT_REPO"
git -C "$STRICT_REPO" init -q
git -C "$STRICT_REPO" config user.name 'Pi5 Candidate Test'
git -C "$STRICT_REPO" config user.email 'pi5-candidate@example.invalid'
printf 'tracked\n' >"$STRICT_REPO/tracked.txt"
git -C "$STRICT_REPO" add tracked.txt
git -C "$STRICT_REPO" commit -qm fixture
strict_sha="$(git -C "$STRICT_REPO" rev-parse HEAD)"
strict_env=(
  PI5_PROJECT_DIR="$STRICT_REPO"
  PI5_BASE_COMPOSE="$ROOT/infrastructure/docker/docker-compose.server.yml"
  PI5_PHASE2_COMPOSE="$ROOT/infrastructure/docker/docker-compose.phase2.yml"
  PI5_ENV_FILE="$ROOT/scripts/deploy/tests/fixtures/pi5-compose.env"
  PI5_DEPLOY_STATE_FILE="$TMP/strict-state.json"
  PI5_DEPLOY_LOCK_FILE="$TMP/strict-lock"
  PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD=1
  PI5_DEPLOY_DRY_RUN=1
  PI5_MIN_FREE_MEMORY_MB=0
  PI5_MIN_FREE_DISK_GB=0
)
git -C "$STRICT_REPO" update-index --assume-unchanged tracked.txt
if env "${strict_env[@]}" "$SCRIPT" prepare --ref "$strict_sha" --run-id run-hidden-assume \
  --resource-evidence "$TMP/hidden-assume.json" >/dev/null 2>&1; then
  fail "assume-unchanged index state was accepted"
fi
git -C "$STRICT_REPO" update-index --no-assume-unchanged tracked.txt
git -C "$STRICT_REPO" update-index --skip-worktree tracked.txt
if env "${strict_env[@]}" "$SCRIPT" prepare --ref "$strict_sha" --run-id run-hidden-skip \
  --resource-evidence "$TMP/hidden-skip.json" >/dev/null 2>&1; then
  fail "skip-worktree index state was accepted"
fi
git -C "$STRICT_REPO" update-index --no-skip-worktree tracked.txt
env "${strict_env[@]}" GIT_DIR="$TMP/poisoned-git-dir" GIT_WORK_TREE="$TMP" \
  "$SCRIPT" prepare --ref "$strict_sha" --run-id run-git-env \
  --resource-evidence "$TMP/git-env-evidence.json" >/dev/null \
  || fail "inherited GIT_* variables poisoned the sealed source lookup"

if env PI5_PROJECT_DIR="$ROOT" PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD=1 \
  PI5_CANDIDATE_TEST_LOAD_AVG=0 PI5_DEPLOY_DRY_RUN=0 "$SCRIPT" status >/dev/null 2>&1; then
  fail "production execution accepted a test-only load override"
fi

protocol_env=(
  PI5_PROJECT_DIR="$ROOT"
  PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD=1
  PI5_DEPLOY_DRY_RUN=0
  PI5_DEPLOY_STATE_FILE="$TMP/protocol-state.json"
  PI5_DEPLOY_LOCK_FILE="$TMP/protocol-lock"
  ROLLING_RELEASE_PROTOCOL=2
  ROLLING_RELEASE_UNIT=raspi-release-run-protocol.service
)
if protocol_error="$(env "${protocol_env[@]}" PI5_CANDIDATE_LOAD_SAMPLE_INTERVAL_SECONDS=1 \
  "$SCRIPT" status 2>&1)"; then
  fail "rolling-release accepted a shortened candidate load interval"
fi
assert_contains "$protocol_error" 'load sample interval is fixed at 20 seconds'
if protocol_error="$(env "${protocol_env[@]}" PI5_CANDIDATE_EVIDENCE_MIN_MEMORY_MB=1 \
  "$SCRIPT" status 2>&1)"; then
  fail "rolling-release accepted a reduced candidate memory threshold"
fi
assert_contains "$protocol_error" 'candidate memory threshold is fixed at 768MB'
if protocol_error="$(env "${protocol_env[@]}" DOCKER_HOST=tcp://127.0.0.1:2375 \
  "$SCRIPT" status 2>&1)"; then
  fail "rolling-release accepted Docker daemon redirection"
fi
assert_contains "$protocol_error" 'Docker/Compose control environment is forbidden under rolling-release: DOCKER_HOST'

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
