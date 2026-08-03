# shellcheck shell=bash
# Source-only legacy capture, maintenance, quarantine, and restore helpers.

legacy_web_env_has_value() {
  local key="$1"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$LEGACY_WEB_ID" |
    awk -F= -v key="$key" '$1 == key && length($2) > 0 { found=1; exit } END { exit(found ? 0 : 1) }'
}
legacy_caddy_config_path() {
  # Keep this priority identical to infrastructure/docker/Dockerfile.web.
  if legacy_web_env_has_value USE_LOCAL_CERTS; then
    printf '%s\n' '/srv/Caddyfile.local'
  elif legacy_web_env_has_value DOMAIN; then
    printf '%s\n' '/srv/Caddyfile.production'
  else
    printf '%s\n' '/srv/Caddyfile'
  fi
}
legacy_maintenance_config_path() {
  local caddy_path="$1"
  if [[ -n "$LEGACY_MAINTENANCE_CONFIG" ]]; then
    printf '%s\n' "$LEGACY_MAINTENANCE_CONFIG"
    return 0
  fi
  case "$caddy_path" in
    /srv/Caddyfile.local) printf '%s\n' "$LEGACY_MAINTENANCE_LOCAL_CONFIG" ;;
    /srv/Caddyfile.production) printf '%s\n' "$LEGACY_MAINTENANCE_PRODUCTION_CONFIG" ;;
    /srv/Caddyfile) printf '%s\n' "$LEGACY_MAINTENANCE_HTTP_CONFIG" ;;
    *) return 1 ;;
  esac
}
legacy_capture() {
  if [[ "$DRY_RUN" == 1 ]]; then
    LEGACY_API_ID='dry-run-legacy-api'; LEGACY_WEB_ID='dry-run-legacy-web'
    LEGACY_API_IMAGE="${LEGACY_API_IMAGE:-registry/legacy-api:1111111111111111111111111111111111111111-captured}"
    LEGACY_WEB_IMAGE="${LEGACY_WEB_IMAGE:-registry/legacy-web:1111111111111111111111111111111111111111-captured}"
    LEGACY_API_RESTART=always; LEGACY_WEB_RESTART=always
    LEGACY_API_WAS_RUNNING=1; LEGACY_WEB_WAS_RUNNING=1
    # Keep dry-run state compact; full Caddyfile capture is for real cutovers only.
    LEGACY_NORMAL_CONFIG_B64='dry-run-captured-normal-caddyfile'
    LEGACY_CADDY_CONFIG_PATH='/srv/Caddyfile'
    return 0
  fi
  LEGACY_API_ID="$(legacy_service_id api)"; LEGACY_WEB_ID="$(legacy_service_id web)"
  [[ -n "$LEGACY_API_ID" && -n "$LEGACY_WEB_ID" ]] || return 1
  LEGACY_API_IMAGE="$(container_image "$LEGACY_API_ID")"; LEGACY_WEB_IMAGE="$(container_image "$LEGACY_WEB_ID")"
  LEGACY_API_RESTART="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$LEGACY_API_ID")"
  LEGACY_WEB_RESTART="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$LEGACY_WEB_ID")"
  docker_running "$LEGACY_API_ID" && LEGACY_API_WAS_RUNNING=1 || LEGACY_API_WAS_RUNNING=0
  docker_running "$LEGACY_WEB_ID" && LEGACY_WEB_WAS_RUNNING=1 || LEGACY_WEB_WAS_RUNNING=0
  LEGACY_CADDY_CONFIG_PATH="$(legacy_caddy_config_path)" || return 1
  LEGACY_NORMAL_CONFIG_B64="$(docker exec "$LEGACY_WEB_ID" sh -c "cat '$LEGACY_CADDY_CONFIG_PATH'" | base64 | tr -d '\n')" || return 1
  [[ -n "$LEGACY_NORMAL_CONFIG_B64" ]]
}

assert_legacy_port_ownership() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local owners
  owners="$(docker ps --format '{{.ID}} {{.Ports}}' | awk '/0\.0\.0\.0:(80|443)->|\[::\]:(80|443)->/ {print $1}' | sort -u)"
  [[ "$owners" == "${LEGACY_WEB_ID:0:12}" || "$owners" == "$LEGACY_WEB_ID" ]]
}
legacy_scheduler_readiness() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  docker exec "$LEGACY_API_ID" node -e "fetch('http://127.0.0.1:8080/api/system/deploy-readiness/internal').then(async r=>{const b=await r.json();process.exit(r.ok&&b.ready===true&&b.scheduler&&b.scheduler.role==='leader'&&b.scheduler.databaseConnection==='connected'?0:1)}).catch(()=>process.exit(1))"
}
legacy_enable_maintenance() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_WEB_MAINTENANCE=1; return 0; }
  local caddy_path maintenance_config
  caddy_path="${LEGACY_CADDY_CONFIG_PATH:-$(legacy_caddy_config_path)}"
  maintenance_config="$(legacy_maintenance_config_path "$caddy_path")" || return 1
  [[ -f "$maintenance_config" ]] || return 1
  docker cp "$maintenance_config" "$LEGACY_WEB_ID:$caddy_path" || return 1
  docker exec "$LEGACY_WEB_ID" caddy reload --config "$caddy_path" --adapter caddyfile || return 1
  LEGACY_WEB_MAINTENANCE=1; maintenance_smoke
}
legacy_quarantine() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_API_QUARANTINED=1; LEGACY_WEB_QUARANTINED=1; return 0; }
  docker update --restart no "$LEGACY_API_ID" "$LEGACY_WEB_ID" >/dev/null || return 1
  LEGACY_API_QUARANTINED=1; LEGACY_WEB_QUARANTINED=1
}
legacy_stop() { [[ "$DRY_RUN" == 1 ]] && return 0; docker stop "$LEGACY_API_ID" >/dev/null; }
legacy_stop_web() {
  # A stopped legacy Web container remains attached to docker_default with its
  # 80/443 publication metadata. Remove it after its image and exact normal
  # Caddyfile have been captured so the fixed gateway becomes the sole port
  # owner. legacy_restore recreates it from the captured image on any failure.
  # Persist deletion authority first. If SIGKILL lands after `docker rm` but
  # before the completion save, reconcile can prove absence against a live
  # daemon and recreate the exact captured image instead of wedging forever.
  LEGACY_WEB_REMOVE_INTENT=1
  persist_legacy_cleanup_progress legacy-web-removal-intent || return 1
  if [[ "$DRY_RUN" == 1 ]]; then
    LEGACY_WEB_REMOVED=1
    persist_legacy_cleanup_progress legacy-web-removal-complete
    return
  fi
  docker stop "$LEGACY_WEB_ID" >/dev/null || return 1
  docker rm "$LEGACY_WEB_ID" >/dev/null 2>&1 \
    || legacy_container_absent "$LEGACY_WEB_ID" || return 1
  legacy_container_absent "$LEGACY_WEB_ID" || return 1
  LEGACY_WEB_REMOVED=1
  persist_legacy_cleanup_progress legacy-web-removal-complete
}
wait_host_ports_free() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local attempt
  for attempt in $(seq 1 30); do
    ! lsof -nP -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1 && ! lsof -nP -iTCP:443 -sTCP:LISTEN >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
wait_legacy_api() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  local attempt
  for attempt in $(seq 1 "$READINESS_RETRIES"); do legacy_scheduler_readiness && return 0; sleep "$READINESS_INTERVAL"; done
  return 1
}
legacy_restore_normal_web_config() {
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_WEB_MAINTENANCE=0; return 0; }
  [[ -n "$LEGACY_NORMAL_CONFIG_B64" ]] || return 1
  local caddy_path
  caddy_path="${LEGACY_CADDY_CONFIG_PATH:-$(legacy_caddy_config_path)}"
  case "$caddy_path" in /srv/Caddyfile|/srv/Caddyfile.local|/srv/Caddyfile.production) ;; *) return 1 ;; esac
  printf '%s' "$LEGACY_NORMAL_CONFIG_B64" | base64 --decode | docker exec -i "$LEGACY_WEB_ID" sh -c "cat > '$caddy_path'" || return 1
  docker exec "$LEGACY_WEB_ID" caddy reload --config "$caddy_path" --adapter caddyfile || return 1
  LEGACY_WEB_MAINTENANCE=0
}

legacy_restore() {
  local rc=0
  [[ "$DRY_RUN" == 1 ]] && { LEGACY_API_QUARANTINED=0; LEGACY_WEB_QUARANTINED=0; LEGACY_API_REMOVED=0; LEGACY_WEB_REMOVED=0; LEGACY_API_REMOVE_INTENT=0; LEGACY_WEB_REMOVE_INTENT=0; LEGACY_WEB_MAINTENANCE=0; return 0; }
  if ((LEGACY_API_REMOVE_INTENT == 1 && LEGACY_API_REMOVED == 0)); then
    [[ -n "$LEGACY_API_ID" ]] || return 1
    legacy_container_absent "$LEGACY_API_ID" && LEGACY_API_REMOVED=1 \
      || docker inspect "$LEGACY_API_ID" >/dev/null 2>&1 || return 1
  fi
  if ((LEGACY_WEB_REMOVE_INTENT == 1 && LEGACY_WEB_REMOVED == 0)); then
    [[ -n "$LEGACY_WEB_ID" ]] || return 1
    legacy_container_absent "$LEGACY_WEB_ID" && LEGACY_WEB_REMOVED=1 \
      || docker inspect "$LEGACY_WEB_ID" >/dev/null 2>&1 || return 1
  fi
  if ((LEGACY_API_REMOVED == 1 || LEGACY_WEB_REMOVED == 1)); then
    [[ -n "$LEGACY_API_IMAGE" && -n "$LEGACY_WEB_IMAGE" ]] || return 1
    if ((LEGACY_API_REMOVED == 1)); then
      legacy_compose_restore up -d --no-build --force-recreate api || rc=1
      LEGACY_API_ID="$(legacy_service_id api)"; [[ -n "$LEGACY_API_ID" ]] || rc=1
      ((rc != 0)) || LEGACY_API_REMOVED=0
    fi
    if ((LEGACY_WEB_REMOVED == 1)); then
      legacy_compose_restore up -d --no-build --force-recreate web || rc=1
      LEGACY_WEB_ID="$(legacy_service_id web)"; [[ -n "$LEGACY_WEB_ID" ]] || rc=1
      ((rc != 0)) || LEGACY_WEB_REMOVED=0
    fi
  fi
  [[ -n "$LEGACY_API_ID" && -n "$LEGACY_WEB_ID" ]] || return 1
  docker update --restart "${LEGACY_API_RESTART:-always}" "$LEGACY_API_ID" >/dev/null || rc=1
  docker update --restart "${LEGACY_WEB_RESTART:-always}" "$LEGACY_WEB_ID" >/dev/null || rc=1
  if ((LEGACY_API_WAS_RUNNING == 1)); then docker_running "$LEGACY_API_ID" || docker start "$LEGACY_API_ID" >/dev/null || rc=1; wait_legacy_api || rc=1; fi
  if ((LEGACY_WEB_WAS_RUNNING == 1)); then docker_running "$LEGACY_WEB_ID" || docker start "$LEGACY_WEB_ID" >/dev/null || rc=1; legacy_restore_normal_web_config || rc=1; fi
  if ((rc == 0)); then
    LEGACY_API_QUARANTINED=0; LEGACY_WEB_QUARANTINED=0
    LEGACY_API_REMOVE_INTENT=0; LEGACY_WEB_REMOVE_INTENT=0
    LEGACY_WEB_MAINTENANCE=0
  fi
  return "$rc"
}

legacy_enforce_quarantine() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  ((LEGACY_API_REMOVED == 1)) || { [[ -n "$LEGACY_API_ID" ]] && docker update --restart no "$LEGACY_API_ID" >/dev/null && docker stop "$LEGACY_API_ID" >/dev/null 2>&1 || true; }
  ((LEGACY_WEB_REMOVED == 1)) || { [[ -n "$LEGACY_WEB_ID" ]] && docker update --restart no "$LEGACY_WEB_ID" >/dev/null && docker stop "$LEGACY_WEB_ID" >/dev/null 2>&1 || true; }
  LEGACY_API_QUARANTINED=1; LEGACY_WEB_QUARANTINED=1
}
phase3_stop_for_recovery() { compose_current stop api-blue web-blue api-green web-green gateway >/dev/null 2>&1 || return 1; }

restore_legacy_after_phase3_stop() {
  # Legacy Web and the Phase 3 gateway both publish 80/443. Stop the gateway
  # before attempting a legacy restore; if restore fails, re-establish gateway
  # maintenance rather than leaving the host without a listener.
  if ! phase3_stop_for_recovery; then
    alert CRITICAL 'could not stop Phase 3 before legacy restore; retaining gateway maintenance where possible'
    ensure_gateway_maintenance || alert CRITICAL 'gateway maintenance could not be re-established after failed Phase 3 stop'
    return 1
  fi
  if legacy_restore; then
    return 0
  fi
  alert CRITICAL 'legacy restore failed after Phase 3 stop; retaining gateway maintenance page'
  ensure_gateway_maintenance || alert CRITICAL 'gateway maintenance page could not be proven after legacy restore failure'
  return 1
}

