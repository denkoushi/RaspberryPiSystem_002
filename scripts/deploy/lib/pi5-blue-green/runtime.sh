# shellcheck shell=bash
# Source-only Compose, gateway, slot identity, readiness, and smoke helpers.

gateway_image() {
  local gateway
  gateway="$(slot_web_image "${GATEWAY_SLOT:-blue}")"
  [[ -n "$gateway" ]] || gateway="${BLUE_WEB_IMAGE:-${WEB_IMAGE:-unused-web}}"
  printf '%s\n' "$gateway"
}

compose_current() {
  local ba="$BLUE_API_IMAGE" ga="$GREEN_API_IMAGE" bw="$BLUE_WEB_IMAGE" gw="$GREEN_WEB_IMAGE" gateway
  [[ -n "$ba" ]] || ba="${API_IMAGE:-unused-api}"
  [[ -n "$ga" ]] || ga="$ba"
  [[ -n "$bw" ]] || bw="${WEB_IMAGE:-unused-web}"
  [[ -n "$gw" ]] || gw="$bw"
  gateway="$(gateway_image)"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf 'DRY-RUN: docker compose -p %q -f %q' "$COMPOSE_PROJECT" "$PHASE3_COMPOSE"; printf ' %q' "$@"; printf '\n'
    return 0
  fi
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  PI5_PROJECT_DIR="$PROJECT_DIR" PI5_ENV_FILE="$ENV_FILE" PI5_BLUE_GREEN_CONFIG_DIR="$CONFIG_DIR" \
    PI5_BLUE_API_IMAGE="$ba" PI5_GREEN_API_IMAGE="$ga" PI5_BLUE_WEB_IMAGE="$bw" \
    PI5_GREEN_WEB_IMAGE="$gw" PI5_GATEWAY_IMAGE="$gateway" \
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$PHASE3_COMPOSE" "$@"
}

compose_migration() {
  PI5_PROJECT_DIR="$PROJECT_DIR" PI5_ENV_FILE="$ENV_FILE" PI5_BLUE_GREEN_CONFIG_DIR="$CONFIG_DIR" \
  PI5_BLUE_API_IMAGE="$BLUE_API_IMAGE" PI5_BLUE_WEB_IMAGE="$BLUE_WEB_IMAGE" \
  PI5_GREEN_API_IMAGE="$GREEN_API_IMAGE" PI5_GREEN_WEB_IMAGE="$GREEN_WEB_IMAGE" \
  PI5_GATEWAY_IMAGE="$(gateway_image)" \
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" \
      -f "$PHASE3_COMPOSE" -f "$PHASE3_MIGRATION_COMPOSE" "$@"
}

legacy_compose() {
  [[ "$DRY_RUN" == 1 ]] && { printf 'DRY-RUN: legacy compose'; printf ' %q' "$@"; printf '\n'; return 0; }
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" "$@"
}

legacy_compose_restore() {
  local restore_override="${PROJECT_DIR}/infrastructure/docker/docker-compose.legacy-restore.yml"
  [[ "$DRY_RUN" == 1 ]] && { printf 'DRY-RUN: legacy restore compose'; printf ' %q' "$@"; printf '\n'; return 0; }
  [[ -f "$ENV_FILE" ]] || die "Compose environment file is missing: $ENV_FILE"
  [[ -n "$LEGACY_API_IMAGE" && -n "$LEGACY_WEB_IMAGE" ]] || die 'legacy restore requires captured LEGACY_*_IMAGE values'
  [[ -f "$restore_override" ]] || die "legacy restore override is missing: $restore_override"
  PI5_LEGACY_API_IMAGE="$LEGACY_API_IMAGE" PI5_LEGACY_WEB_IMAGE="$LEGACY_WEB_IMAGE" \
    docker compose --env-file "$ENV_FILE" -f "$BASE_COMPOSE" -f "$restore_override" "$@"
}

render_gateway() {
  local mode="$1" slot="${2:-}" template api web
  if [[ "$mode" == maintenance ]]; then
    template="$GATEWAY_MAINTENANCE_TEMPLATE"
    if [[ ! -f "$template" ]]; then
      if [[ "$HTTP_ONLY" == 1 ]]; then
        template="${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.http"
      else
        template="${PROJECT_DIR}/infrastructure/docker/Caddyfile.maintenance.production"
      fi
    fi
    api='maintenance'; web='maintenance'
  else
    is_slot "$slot" || die 'application gateway render requires a slot'
    template="$GATEWAY_TEMPLATE"; [[ "$HTTP_ONLY" == 1 ]] && template="$GATEWAY_HTTP_TEMPLATE"
    api="api-${slot}:8080"; web="web-${slot}:80"
  fi
  [[ -f "$template" ]] || die "gateway template is missing: $template"
  mkdir -p "$CONFIG_DIR"
  python3 - "$template" "$CONFIG_DIR/Caddyfile" "$api" "$web" <<'PY'
import os,sys,tempfile
template,destination,api,web=sys.argv[1:]
with open(template,encoding='utf-8') as f: content=f.read()
content=content.replace('__BLUE_GREEN_API_UPSTREAM__',api).replace('__BLUE_GREEN_WEB_UPSTREAM__',web)
fd,tmp=tempfile.mkstemp(prefix='.Caddyfile-',dir=os.path.dirname(destination),text=True)
with os.fdopen(fd,'w',encoding='utf-8') as f: f.write(content); f.flush(); os.fsync(f.fileno())
os.replace(tmp,destination)
PY
  log "gateway config rendered: mode=${mode} slot=${slot:-none}"
}

gateway_config_validate() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local cid; cid="$(compose_current ps -q gateway 2>/dev/null || true)"
  if [[ -n "$cid" ]]; then docker exec "$cid" caddy validate --config /srv/bluegreen/Caddyfile >/dev/null; else return 0; fi
}

# A failed bootstrap stops the gateway. Reusing that stopped container leaves
# its Docker port publication/network endpoint stale on Pi5, even though Caddy
# starts inside it. Always create a fresh fixed-port owner for a new handoff.
gateway_start() { [[ "$DRY_RUN" == 1 ]] && return 0; compose_current up -d --force-recreate gateway; }
gateway_reload() { [[ "$DRY_RUN" == 1 ]] && return 0; compose_current exec -T gateway caddy reload --config /srv/bluegreen/Caddyfile; }
gateway_smoke_url() {
  local url="$1" attempt
  [[ "$DRY_RUN" == 1 ]] && return 0
  for attempt in $(seq 1 "$GATEWAY_READY_RETRIES"); do
    if curl -kfsS --max-time 5 "$url" >/dev/null; then return 0; fi
    sleep "$GATEWAY_READY_INTERVAL"
  done
  return 1
}
gateway_smoke_once() {
  local url="$1"
  [[ "$DRY_RUN" == 1 ]] && return 0
  curl -kfsS --max-time 5 "$url" >/dev/null
}
maintenance_smoke() { gateway_smoke_url "$WEB_URL"; }
external_smoke() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  gateway_smoke_url "$API_HEALTH_URL" || return 1
  gateway_smoke_url "$WEB_URL" || return 1
  [[ -z "$KIOSK_HEALTH_URL" ]] || gateway_smoke_url "$KIOSK_HEALTH_URL" || return 1
}
external_smoke_once() {
  gateway_smoke_once "$API_HEALTH_URL" || return 1
  gateway_smoke_once "$WEB_URL" || return 1
  [[ -z "$KIOSK_HEALTH_URL" ]] || gateway_smoke_once "$KIOSK_HEALTH_URL" || return 1
}
gateway_points_to() {
  local slot="$1"
  [[ -f "$CONFIG_DIR/Caddyfile" ]] || return 1
  grep -Fq "api-${slot}:8080" "$CONFIG_DIR/Caddyfile" && grep -Fq "web-${slot}:80" "$CONFIG_DIR/Caddyfile"
}

ensure_gateway_maintenance() {
  render_gateway maintenance || return 1
  gateway_config_validate || return 1
  if [[ "$DRY_RUN" == 1 ]]; then return 0; fi
  if [[ -z "$(compose_current ps -q gateway 2>/dev/null || true)" ]]; then gateway_start || return 1
  else gateway_reload || gateway_start || return 1
  fi
  maintenance_smoke || return 1
}

slot_container_id() { compose_current ps -q "$1" 2>/dev/null || true; }
slot_any_container_id() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  compose_current ps -a -q "$1" 2>/dev/null || true
}
docker_running() { [[ "$DRY_RUN" == 1 ]] && return 0; [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == true ]]; }
container_image() { [[ "$DRY_RUN" == 1 ]] && printf 'dry-run-image\n' || docker inspect -f '{{.Config.Image}}' "$1"; }
verify_slot_runtime_config() {
  local slot="$1" service container_id image_id
  is_slot "$slot" || return 1
  [[ "$DRY_RUN" == 1 ]] && { printf 'sha256:%064d\n' 0; return 0; }
  service="api-${slot}"
  container_id="$(slot_container_id "$service")"
  [[ -n "$container_id" ]] || return 1
  image_id="$(docker inspect -f '{{.Image}}' "$container_id")"
  [[ -n "$image_id" ]] || return 1
  # Process substitution keeps effective and observed values out of argv,
  # temporary files, logs, and durable state.  The verifier emits only a
  # canonical digest on success and key names (never values) on failure.
  python3 "$RUNTIME_CONFIG_VERIFIER" \
    --service "$service" \
    --compose-json <(compose_current config --format json) \
    --image-env-json <(docker image inspect -f '{{json .Config.Env}}' "$image_id") \
    --inspect-json <(docker inspect -f '{{json .Config.Env}}' "$container_id")
}
verify_slot_identity() {
  local slot="$1" api_id web_id expected_api_id expected_web_id
  [[ "$DRY_RUN" == 1 ]] && return 0
  api_id="$(slot_container_id "api-${slot}")"; web_id="$(slot_container_id "web-${slot}")"
  [[ -n "$api_id" && -n "$web_id" ]] || return 1
  [[ "$(container_image "$api_id")" == "$(slot_api_image "$slot")" ]] || return 1
  [[ "$(container_image "$web_id")" == "$(slot_web_image "$slot")" ]] || return 1
  expected_api_id="$(slot_api_image_id "$slot")"; expected_web_id="$(slot_web_image_id "$slot")"
  [[ "$expected_api_id" =~ ^sha256:[0-9a-f]{64}$ && "$expected_web_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker inspect -f '{{.Image}}' "$api_id")" == "$expected_api_id" ]] || return 1
  [[ "$(docker inspect -f '{{.Image}}' "$web_id")" == "$expected_web_id" ]] || return 1
}

# During committed cleanup the previous API may be stopped and either previous
# container may already have been removed. Any container that still exists
# must nevertheless match both the durable tag and immutable image ID.
verify_present_slot_identity() {
  local slot="$1" kind container expected_image expected_id
  [[ "$DRY_RUN" == 1 ]] && return 0
  is_slot "$slot" || return 1
  for kind in api web; do
    container="$(slot_any_container_id "${kind}-${slot}")"
    [[ -n "$container" ]] || continue
    if [[ "$kind" == api ]]; then
      expected_image="$(slot_api_image "$slot")"
      expected_id="$(slot_api_image_id "$slot")"
    else
      expected_image="$(slot_web_image "$slot")"
      expected_id="$(slot_web_image_id "$slot")"
    fi
    [[ -n "$expected_image" && "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    [[ "$(container_image "$container")" == "$expected_image" ]] || return 1
    [[ "$(docker inspect -f '{{.Image}}' "$container")" == "$expected_id" ]] || return 1
  done
}

seal_active_slot_image_ids() {
  local slot="$ACTIVE_SLOT" api_container web_container api_id web_id
  [[ "$DRY_RUN" == 1 ]] && return 0
  if [[ "$(slot_api_image_id "$slot")" =~ ^sha256:[0-9a-f]{64}$ \
    && "$(slot_web_image_id "$slot")" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    return 0
  fi
  api_container="$(slot_container_id "api-${slot}")"; web_container="$(slot_container_id "web-${slot}")"
  [[ -n "$api_container" && -n "$web_container" ]] || die 'active slot containers are unavailable for one-time image identity sealing'
  [[ "$(container_image "$api_container")" == "$(slot_api_image "$slot")" \
    && "$(container_image "$web_container")" == "$(slot_web_image "$slot")" ]] \
    || die 'active slot tags do not match durable state during image identity sealing'
  scheduler_readiness "$slot" leader || die 'active slot is not a scheduler leader during image identity sealing'
  verify_slot_runtime_config "$slot" >/dev/null || die 'active slot runtime configuration is not verified during image identity sealing'
  api_id="$(docker inspect -f '{{.Image}}' "$api_container")"
  web_id="$(docker inspect -f '{{.Image}}' "$web_container")"
  [[ "$api_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || die 'active slot image identity is malformed'
  [[ "$(docker image inspect -f '{{.Id}}' "$(slot_api_image "$slot")")" == "$api_id" \
    && "$(docker image inspect -f '{{.Id}}' "$(slot_web_image "$slot")")" == "$web_id" ]] \
    || die 'active slot image tag was retargeted during identity sealing'
  set_slot_image_ids "$slot" "$api_id" "$web_id"
}

seal_legacy_state_image_ids() {
  if [[ ! -f "$STATE_FILE" ]]; then
    log 'Blue/Green state is not initialized; no image identities need sealing'
    return 0
  fi
  load_state_context
  local slot referenced api_container web_container api_id web_id changed=0
  local event reason result
  event="$(state_get event)"
  for slot in blue green; do
    referenced=0
    for value in "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
      "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT"; do
      [[ "$value" == "$slot" ]] && referenced=1
    done
    [[ "$GATEWAY_MODE" != application || "$GATEWAY_SLOT" != "$slot" ]] || referenced=1
    ((referenced == 1)) || continue

    if [[ "$(slot_api_image_id "$slot")" =~ ^sha256:[0-9a-f]{64}$ \
      && "$(slot_web_image_id "$slot")" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      if [[ "$event" == bootstrap-preparing || "$event" == bootstrapping \
        || "$event" == bootstrap-failed ]]; then
        if [[ "$DRY_RUN" != 1 ]]; then
          [[ "$(docker image inspect -f '{{.Id}}' "$(slot_api_image "$slot")" 2>/dev/null || true)" == "$(slot_api_image_id "$slot")" \
            && "$(docker image inspect -f '{{.Id}}' "$(slot_web_image "$slot")" 2>/dev/null || true)" == "$(slot_web_image_id "$slot")" ]] \
            || die "sealed bootstrap ${slot} image tag was retargeted"
        fi
        verify_present_slot_identity "$slot" \
          || die "bootstrap ${slot} image identities do not match remaining containers"
      elif [[ "$event" == cleanup-handoff && "$slot" == "$PREVIOUS_SLOT" \
        || ( "$event" == preparing || "$event" == prepare-failed ) \
          && "$slot" == "$CANDIDATE_SLOT" ]]; then
        verify_present_slot_identity "$slot" \
          || die "sealed cleanup-slot image identities do not match the remaining containers"
      else
        verify_slot_identity "$slot" \
          || die "sealed ${slot} image identities do not match the live containers"
      fi
      continue
    fi

    api_container="$(slot_container_id "api-${slot}")"
    web_container="$(slot_container_id "web-${slot}")"
    [[ -n "$api_container" && -n "$web_container" ]] \
      || die "legacy ${slot} containers are unavailable for one-time image identity sealing"
    docker_running "$api_container" && docker_running "$web_container" \
      || die "legacy ${slot} containers are not running during image identity sealing"
    [[ "$(container_image "$api_container")" == "$(slot_api_image "$slot")" \
      && "$(container_image "$web_container")" == "$(slot_web_image "$slot")" ]] \
      || die "legacy ${slot} container tags do not match durable state"
    api_id="$(docker inspect -f '{{.Image}}' "$api_container")"
    web_id="$(docker inspect -f '{{.Image}}' "$web_container")"
    [[ "$api_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || die "legacy ${slot} image identities are malformed"
    [[ "$(docker image inspect -f '{{.Id}}' "$(slot_api_image "$slot")")" == "$api_id" \
      && "$(docker image inspect -f '{{.Id}}' "$(slot_web_image "$slot")")" == "$web_id" ]] \
      || die "legacy ${slot} image tag was retargeted before one-time sealing"
    set_slot_image_ids "$slot" "$api_id" "$web_id"
    changed=1
  done

  ((changed == 1)) || { log 'Blue/Green image identities are already sealed'; return 0; }
  if [[ "$GATEWAY_MODE" == application ]]; then
    is_slot "$GATEWAY_SLOT" && gateway_points_to "$GATEWAY_SLOT" \
      || die 'gateway state is not consistent during one-time image identity sealing'
  fi
  reason="$(state_get rollbackReason)"; result="$(state_get result)"
  state_save "$event" "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    "$GATEWAY_MODE" "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" \
    "$MONITOR_ROLLBACK_SLOT" "$reason" "${result:-image-identities-sealed}"
  log 'sealed legacy schema-v2 slot image identities'
}

scheduler_readiness() {
  local slot="$1" expected_role="$2" cid
  [[ "$DRY_RUN" == 1 ]] && return 0
  cid="$(slot_container_id "api-${slot}")"; [[ -n "$cid" ]] || return 1
  docker exec "$cid" node - "$expected_role" <<'JS'
const role=process.argv[2];
fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal')
 .then(async response => {
   const body=await response.json().catch(()=>null);
   const scheduler=body && body.scheduler;
   const ok=response.ok && body && body.ready===true && body.database==='ready' &&
     scheduler && scheduler.enabled===true && scheduler.role===role &&
     scheduler.databaseConnection==='connected';
   process.exit(ok?0:1);
 }).catch(()=>process.exit(1));
JS
}

slot_runtime_ready() {
  local slot="$1" role="$2" attempt
  [[ "$DRY_RUN" == 1 ]] && return 0
  for attempt in $(seq 1 "$READINESS_RETRIES"); do
    verify_slot_identity "$slot" && scheduler_readiness "$slot" "$role" && return 0
    sleep "$READINESS_INTERVAL"
  done
  return 1
}

slot_web_validate() {
  local slot="$1" cid
  [[ "$DRY_RUN" == 1 ]] && return 0
  cid="$(slot_container_id "web-${slot}")"; [[ -n "$cid" ]] || return 1
  docker exec "$cid" caddy validate --config /srv/Caddyfile.slot >/dev/null
}

slot_structural_ready() {
  local slot="$1" role="$2"
  slot_runtime_ready "$slot" "$role" && slot_web_validate "$slot"
}

slot_ready() {
  local slot="$1" role="$2"
  verify_slot_runtime_config "$slot" >/dev/null && \
    slot_structural_ready "$slot" "$role"
}

slot_up() {
  local slot="$1" role="$2"
  compose_current up -d "api-${slot}" "web-${slot}" || return 1
  slot_ready "$slot" "$role"
}

legacy_service_id() { legacy_compose ps -q "$1" 2>/dev/null || true; }
