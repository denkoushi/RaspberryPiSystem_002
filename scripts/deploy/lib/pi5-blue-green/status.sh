# shellcheck shell=bash
# Source-only observation and status JSON reporting.

status_report() {
  if [[ ! -f "$STATE_FILE" ]]; then printf '{"state":"not-initialized"}\n'; return 0; fi
  state_assert
  local stale=0 slot expected=leader event live_health_status=verified
  local runtime_config_status=not-checked runtime_config_digest=''
  load_state_context
  event="$(state_get event)"
  case "$event" in
    active|monitor-passed|monitor-failed|reconciled)
      if [[ -n "$PREVIOUS_SLOT" ]]; then
        if [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -ge STABLE_UNTIL ]]; then
          expected=transitioning
        else
          expected=standby
        fi
      fi
      ;;
    cleanup-handoff)
      expected=transitioning
      ;;
  esac
  if [[ "$DRY_RUN" != 1 ]]; then
    if ! is_slot "$ACTIVE_SLOT" || [[ -z "$(slot_container_id "api-${ACTIVE_SLOT}")" || -z "$(slot_container_id "web-${ACTIVE_SLOT}")" ]]; then
      stale=1
    fi
    for slot in blue green; do
      if [[ "$event" == cleanup-handoff && "$slot" == "$PREVIOUS_SLOT" ]]; then
        verify_present_slot_identity "$slot" || stale=1
      elif [[ -n "$(slot_container_id "api-${slot}")" || -n "$(slot_container_id "web-${slot}")" ]]; then
        verify_slot_identity "$slot" || stale=1
      fi
    done
    if [[ "$GATEWAY_MODE" == application ]] && is_slot "$GATEWAY_SLOT"; then gateway_points_to "$GATEWAY_SLOT" || stale=1; fi
    if ((STRUCTURAL_ONLY == 0)) && is_slot "$ACTIVE_SLOT"; then
      if runtime_config_digest="$(verify_slot_runtime_config "$ACTIVE_SLOT")"; then
        runtime_config_status=verified
      else
        runtime_config_status=mismatch
        runtime_config_digest=''
        stale=1
      fi
    elif ! is_slot "$ACTIVE_SLOT"; then
      runtime_config_status=unavailable
    fi

    if is_slot "$ACTIVE_SLOT"; then
      if [[ "$expected" == transitioning ]]; then
        if scheduler_readiness "$ACTIVE_SLOT" leader; then
          expected=leader
        elif scheduler_readiness "$ACTIVE_SLOT" standby \
          && is_slot "$PREVIOUS_SLOT" \
          && scheduler_readiness "$PREVIOUS_SLOT" leader; then
          expected=standby
        else live_health_status=failed
        fi
      elif ! scheduler_readiness "$ACTIVE_SLOT" "$expected"; then
        live_health_status=failed
      fi
      if [[ "$expected" == standby && "$event" != cleanup-handoff ]] \
        && { ! is_slot "$PREVIOUS_SLOT" || ! scheduler_readiness "$PREVIOUS_SLOT" leader; }; then
        live_health_status=failed
      fi
      if [[ "$GATEWAY_MODE" != application || "$GATEWAY_SLOT" != "$ACTIVE_SLOT" ]] \
        || ! slot_web_validate "$ACTIVE_SLOT" \
        || ! external_smoke_once; then
        live_health_status=failed
      fi
    else
      live_health_status=failed
    fi
    [[ "$live_health_status" == verified ]] || stale=1
  fi
  python3 - "$STATE_FILE" "$stale" "$expected" "$runtime_config_status" \
    "$runtime_config_digest" "$live_health_status" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f:s=json.load(f)
s['runtimeStatus']='stale' if sys.argv[2]=='1' else 'consistent'
s['expectedActiveSchedulerRole']=sys.argv[3]
s['runtimeConfigStatus']=sys.argv[4]
s['runtimeConfigDigest']=sys.argv[5] or None
s['liveHealthStatus']=sys.argv[6]
print(json.dumps(s,ensure_ascii=False,indent=2,sort_keys=True))
PY
  ((stale == 0))
}

# -----------------------------------------------------------------------------
