# shellcheck shell=bash
# Source-only immutable image, resource, release-evidence, and secret guards.

slot_api_image() { [[ "$1" == blue ]] && printf '%s\n' "$BLUE_API_IMAGE" || printf '%s\n' "$GREEN_API_IMAGE"; }
slot_web_image() { [[ "$1" == blue ]] && printf '%s\n' "$BLUE_WEB_IMAGE" || printf '%s\n' "$GREEN_WEB_IMAGE"; }
slot_api_image_id() { [[ "$1" == blue ]] && printf '%s\n' "$BLUE_API_IMAGE_ID" || printf '%s\n' "$GREEN_API_IMAGE_ID"; }
slot_web_image_id() { [[ "$1" == blue ]] && printf '%s\n' "$BLUE_WEB_IMAGE_ID" || printf '%s\n' "$GREEN_WEB_IMAGE_ID"; }
set_slot_image_ids() {
  local slot="$1" api_id="$2" web_id="$3"
  if [[ "$slot" == blue ]]; then
    BLUE_API_IMAGE_ID="$api_id"; BLUE_WEB_IMAGE_ID="$web_id"
  else
    GREEN_API_IMAGE_ID="$api_id"; GREEN_WEB_IMAGE_ID="$web_id"
  fi
}

persist_current_state() {
  local result="$1" event reason
  event="$(state_get event)"; reason="$(state_get rollbackReason)"
  [[ -n "$event" ]] || return 1
  state_save "$event" "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    "$GATEWAY_MODE" "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" \
    "$MONITOR_ROLLBACK_SLOT" "$reason" "$result"
}

run_scoped_image_tag() {
  [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}:[0-9a-f]{40}-[0-9a-f]{12}-[0-9a-f]{64}$ ]]
}

retired_image_absent() {
  local image="$1"
  if docker image inspect "$image" >/dev/null 2>&1; then return 1; fi
  docker info >/dev/null 2>&1
}

cleanup_retired_images() {
  [[ -n "$RETIRED_API_IMAGE" || -n "$RETIRED_WEB_IMAGE" \
    || -n "$RETIRED_API_IMAGE_ID" || -n "$RETIRED_WEB_IMAGE_ID" ]] || return 0
  run_scoped_image_tag "$RETIRED_API_IMAGE" \
    && run_scoped_image_tag "$RETIRED_WEB_IMAGE" \
    && [[ "$RETIRED_API_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ \
      && "$RETIRED_WEB_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || return 1
  local current container containers image expected_id observed_id
  for current in "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE"; do
    [[ "$current" != "$RETIRED_API_IMAGE" && "$current" != "$RETIRED_WEB_IMAGE" ]] \
      || return 1
  done
  if [[ "$DRY_RUN" != 1 ]]; then
    containers="$(docker ps -aq 2>/dev/null)" || return 1
    for container in $containers; do
      observed_id="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)" \
        || return 1
      [[ "$observed_id" != "$RETIRED_API_IMAGE_ID" \
        && "$observed_id" != "$RETIRED_WEB_IMAGE_ID" ]] || return 1
    done
    for image in "$RETIRED_API_IMAGE" "$RETIRED_WEB_IMAGE"; do
      if [[ "$image" == "$RETIRED_API_IMAGE" ]]; then expected_id="$RETIRED_API_IMAGE_ID"
      else expected_id="$RETIRED_WEB_IMAGE_ID"
      fi
      if ! retired_image_absent "$image"; then
        observed_id="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null)" \
          || return 1
        [[ "$observed_id" == "$expected_id" ]] || return 1
        docker image rm "$image" >/dev/null 2>&1 \
          || retired_image_absent "$image" || return 1
        retired_image_absent "$image" || return 1
      fi
    done
  fi
  RETIRED_API_IMAGE=''; RETIRED_WEB_IMAGE=''
  RETIRED_API_IMAGE_ID=''; RETIRED_WEB_IMAGE_ID=''
  persist_current_state retired-image-tags-cleaned
}

image_commit() {
  python3 - "$1" <<'PY'
import re, sys
matches=re.findall(r'(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])',sys.argv[1],re.I)
if len(matches) != 1: raise SystemExit(1)
print(matches[0].lower())
PY
}

validate_image_pair() {
  local api="$1" web="$2" api_commit web_commit
  # DRY_RUN lifecycle fixtures may use non-commit tags; still enforce pair equality
  # when both tags contain an immutable commit SHA.
  if api_commit="$(image_commit "$api" 2>/dev/null || true)" && web_commit="$(image_commit "$web" 2>/dev/null || true)"; then
    if [[ -n "$api_commit" && -n "$web_commit" ]]; then
      [[ "$api_commit" == "$web_commit" ]] || die 'API and Web images do not share the same immutable commit tag'
      return 0
    fi
  fi
  if [[ "$DRY_RUN" == 1 ]]; then
    return 0
  fi
  api_commit="$(image_commit "$api")" || die "API image tag is not an immutable commit/config tag: $api"
  web_commit="$(image_commit "$web")" || die "Web image tag is not an immutable commit/config tag: $web"
  [[ "$api_commit" == "$web_commit" ]] || die 'API and Web images do not share the same immutable commit tag'
}

resolve_images() {
  [[ -n "$API_IMAGE" ]] || API_IMAGE="$(python3 - "$PHASE2_STATE_FILE" 2>/dev/null <<'PY' || true
import json,sys
with open(sys.argv[1]) as f:s=json.load(f)
print((s.get('candidate') or {}).get('api') or '')
PY
)"
  [[ -n "$WEB_IMAGE" ]] || WEB_IMAGE="$(python3 - "$PHASE2_STATE_FILE" 2>/dev/null <<'PY' || true
import json,sys
with open(sys.argv[1]) as f:s=json.load(f)
print((s.get('candidate') or {}).get('web') or '')
PY
)"
  [[ -n "$API_IMAGE" && -n "$WEB_IMAGE" ]] || die 'candidate images are missing; pass --api-image and --web-image'
  validate_image_pair "$API_IMAGE" "$WEB_IMAGE"
  [[ "$DRY_RUN" == 1 ]] || docker image inspect "$API_IMAGE" "$WEB_IMAGE" >/dev/null || die 'candidate image is missing locally'
}

resource_value() {
  case "$1" in
    memory) [[ -n "${PI5_BLUE_GREEN_TEST_MEMORY_MB:-}" ]] && printf '%s\n' "$PI5_BLUE_GREEN_TEST_MEMORY_MB" || awk '/MemAvailable:/ {print int($2/1024); exit}' /proc/meminfo ;;
    disk) [[ -n "${PI5_BLUE_GREEN_TEST_DISK_GB:-}" ]] && printf '%s\n' "$PI5_BLUE_GREEN_TEST_DISK_GB" || df -Pk "$PROJECT_DIR" | awk 'NR==2 {print int($4/1024/1024); exit}' ;;
    load) [[ -n "${PI5_BLUE_GREEN_TEST_LOAD_AVG:-}" ]] && printf '%s\n' "$PI5_BLUE_GREEN_TEST_LOAD_AVG" || awk '{print $1; exit}' /proc/loadavg ;;
  esac
}

maximum_load_policy() {
  local cpu_count
  if [[ -n "$MAX_LOAD_AVG" ]]; then printf '%s\n' "$MAX_LOAD_AVG"; return; fi
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || true)"
  [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]] || die 'online CPU count could not be read'
  awk "BEGIN {printf \"%.2f\", $cpu_count * 0.75}"
}

maximum_evidence_load_policy() {
  local cpu_count
  if [[ -n "$EVIDENCE_MAX_LOAD_AVG" ]]; then printf '%s\n' "$EVIDENCE_MAX_LOAD_AVG"; return; fi
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || true)"
  [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]] || die 'online CPU count could not be read'
  awk "BEGIN {printf \"%.2f\", $cpu_count * 0.75}"
}

resource_guard() {
  [[ "$DRY_RUN" == 1 && "${PI5_BLUE_GREEN_SKIP_RESOURCE_GUARD:-0}" == 1 ]] && return 0
  local memory disk load max_load cpu_count
  memory="$(resource_value memory)"; disk="$(resource_value disk)"; load="$(resource_value load)"
  [[ "$memory" =~ ^[0-9]+$ ]] || die 'available memory could not be read'
  [[ "$disk" =~ ^[0-9]+$ ]] || die 'free disk could not be read'
  [[ "$load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'load average could not be read'
  max_load="$(maximum_load_policy)"
  [[ "$max_load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'maximum load average is invalid'
  awk "BEGIN {exit !($load < $max_load)}" || die "load average ${load} is not below ${max_load}"
  ((memory >= MIN_MEMORY_MB)) || die "available memory ${memory}MB is below ${MIN_MEMORY_MB}MB; use Phase 2"
  ((disk >= MIN_DISK_GB)) || die "free disk ${disk}GB is below ${MIN_DISK_GB}GB; use Phase 2"
  log "resource gate passed: memory=${memory}MB disk=${disk}GB load=${load}/${max_load}"
}

validate_resource_evidence() {
  if [[ "$DRY_RUN" == 1 && "${PI5_BLUE_GREEN_TEST_ALLOW_MISSING_RELEASE_EVIDENCE:-0}" == 1 ]]; then
    resource_guard
    return 0
  fi
  [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] || die '--run-id is required for candidate preparation'
  [[ -n "$RESOURCE_EVIDENCE_FILE" ]] || die '--resource-evidence is required for candidate preparation'
  local desired_sha api_id web_id maximum
  desired_sha="$(image_commit "$API_IMAGE")" || die 'candidate API image does not contain one immutable commit SHA'
  [[ "$(image_commit "$WEB_IMAGE")" == "$desired_sha" ]] || die 'candidate images do not share the desired SHA'
  api_id="$(docker image inspect -f '{{.Id}}' "$API_IMAGE")"
  web_id="$(docker image inspect -f '{{.Id}}' "$WEB_IMAGE")"
  maximum="$(maximum_evidence_load_policy)"
  python3 "$RELEASE_EVIDENCE_HELPER" verify-resource \
    --path "$RESOURCE_EVIDENCE_FILE" --run-id "$RUN_ID" --sha "$desired_sha" \
    --api-image "$API_IMAGE" --web-image "$WEB_IMAGE" \
    --api-image-id "$api_id" --web-image-id "$web_id" \
    --min-memory-mb "$EVIDENCE_MIN_MEMORY_MB" --min-disk-gb "$EVIDENCE_MIN_DISK_GB" \
    --max-load "$maximum" >/dev/null \
    || die 'candidate resource evidence is stale, tampered, or belongs to another release'
  CANDIDATE_API_IMAGE_ID="$api_id"
  CANDIDATE_WEB_IMAGE_ID="$web_id"
  RELEASE_RUN_ID="$RUN_ID"
  RELEASE_DESIRED_SHA="$desired_sha"
  RELEASE_RESOURCE_EVIDENCE="$RESOURCE_EVIDENCE_FILE"
  RELEASE_RESOURCE_EVIDENCE_SHA256="$(python3 - "$RESOURCE_EVIDENCE_FILE" <<'PY'
import hashlib, pathlib, sys
print('sha256:' + hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
  # The build stage owns the bounded load wait. Phase 3 only performs this
  # cheap current-condition recheck before it mutates DB/runtime state.
  resource_guard
}

verify_durable_release_evidence() {
  local slot="$1" observed_hash maximum
  [[ "$DRY_RUN" == 1 ]] && return 0
  [[ "$RELEASE_RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ \
    && "$RELEASE_DESIRED_SHA" =~ ^[0-9a-f]{40}$ \
    && -f "$RELEASE_RESOURCE_EVIDENCE" \
    && "$RELEASE_RESOURCE_EVIDENCE_SHA256" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  observed_hash="$(python3 - "$RELEASE_RESOURCE_EVIDENCE" <<'PY'
import hashlib, pathlib, sys
print('sha256:' + hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)" || return 1
  [[ "$observed_hash" == "$RELEASE_RESOURCE_EVIDENCE_SHA256" ]] || return 1
  maximum="$(maximum_evidence_load_policy)" || return 1
  python3 "$RELEASE_EVIDENCE_HELPER" verify-resource \
    --path "$RELEASE_RESOURCE_EVIDENCE" --run-id "$RELEASE_RUN_ID" --sha "$RELEASE_DESIRED_SHA" \
    --api-image "$(slot_api_image "$slot")" --web-image "$(slot_web_image "$slot")" \
    --api-image-id "$(slot_api_image_id "$slot")" --web-image-id "$(slot_web_image_id "$slot")" \
    --min-memory-mb "$EVIDENCE_MIN_MEMORY_MB" --min-disk-gb "$EVIDENCE_MIN_DISK_GB" \
    --max-load "$maximum" >/dev/null
}

secret_guard() {
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  python3 - "$ENV_FILE" <<'PY' || die 'JWT secrets are empty, replace-me, or weak; refusing candidate start'
import re,sys
values={}
with open(sys.argv[1],encoding='utf-8') as f:
  for raw in f:
    line=raw.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); values[k.strip()]=v.strip().strip('"').strip("'")
# Placeholder/weak patterns only — do not treat the substring "secret" inside a strong value as weak.
weak=re.compile(r'(change[-_]?me|replace[-_]?me|example|password|^secret$|test[-_]|dev[-_])',re.I)
for key in ('JWT_ACCESS_SECRET','JWT_REFRESH_SECRET'):
  value=values.get(key,'')
  if len(value)<32 or weak.search(value): raise SystemExit(f'{key} is weak')
if values['JWT_ACCESS_SECRET']==values['JWT_REFRESH_SECRET']:
  raise SystemExit('JWT secrets must differ')
PY
}

