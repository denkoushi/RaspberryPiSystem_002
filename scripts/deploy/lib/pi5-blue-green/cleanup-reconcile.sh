# shellcheck shell=bash
# Source-only crash-resumable cleanup, candidate discard, and reconciliation operations.

legacy_container_absent() {
  local container="$1"
  if docker inspect "$container" >/dev/null 2>&1; then
    return 1
  fi
  # `inspect` also fails when the daemon is unavailable. Prove the daemon is
  # responsive before classifying a missing immutable container ID as already
  # removed after a crash.
  docker info >/dev/null 2>&1
}

persist_legacy_cleanup_progress() {
  local result="$1" event reason
  event="$(state_get event)"; reason="$(state_get rollbackReason)"
  [[ -n "$event" ]] || return 1
  state_save "$event" "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    "$GATEWAY_MODE" "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" \
    "$MONITOR_ROLLBACK_SLOT" "$reason" "$result"
}

remove_legacy_container_once() {
  local kind="$1" container removed result
  case "$kind" in
    api) container="$LEGACY_API_ID"; removed="$LEGACY_API_REMOVED" ;;
    web) container="$LEGACY_WEB_ID"; removed="$LEGACY_WEB_REMOVED" ;;
    *) return 2 ;;
  esac
  ((removed == 0)) || return 0
  [[ -n "$container" ]] || return 1

  if ! legacy_container_absent "$container"; then
    # A daemon disconnect can lose the successful `rm` response. Resolve the
    # boundary from live absence instead of wedging on the command result.
    docker rm "$container" >/dev/null 2>&1 || legacy_container_absent "$container" || return 1
    legacy_container_absent "$container" || return 1
  fi
  if [[ "$kind" == api ]]; then LEGACY_API_REMOVED=1
  else LEGACY_WEB_REMOVED=1
  fi
  result="legacy-${kind}-cleanup-complete"
  persist_legacy_cleanup_progress "$result"
}

cleanup_legacy() {
  if [[ "$DRY_RUN" == 1 ]]; then
    LEGACY_API_REMOVED=1; LEGACY_WEB_REMOVED=1
    return 0
  fi
  # Stop at the first unpersisted boundary. A retry treats a missing container
  # ID as the already-completed removal, then durably records it before moving
  # to the next service.
  remove_legacy_container_once api || return 1
  remove_legacy_container_once web
}

# Persist the cleanup transaction before stopping the previous scheduler
# leader. The same transaction can then resume after a crash at any subsequent
# stop/rm/state-save boundary without pretending the removed slot is still a
# rollback target.
cleanup_previous_slot_transaction() {
  local previous="$1" event previous_web
  event="$(state_get event)"
  if [[ "$event" != cleanup-handoff ]]; then
    CANDIDATE_SLOT="$previous"; PREVIOUS_SLOT="$previous"
    STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
    state_save cleanup-handoff "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
      "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
      application "$ACTIVE_SLOT" '' '' '' '' cleanup-handoff-started || return 1
  else
    [[ "$CANDIDATE_SLOT" == "$previous" && "$PREVIOUS_SLOT" == "$previous" \
      && -z "$STABLE_UNTIL" && -z "$MONITOR_ACTIVE_SLOT" && -z "$MONITOR_ROLLBACK_SLOT" ]] \
      || return 1
  fi

  if verify_slot_identity "$previous" && scheduler_readiness "$previous" leader; then
    if ((STRUCTURAL_ONLY == 1)); then
      slot_structural_ready "$ACTIVE_SLOT" standby || return 1
    else
      slot_ready "$ACTIVE_SLOT" standby || return 1
    fi
    compose_current stop "api-${previous}" || return 1
    if ! slot_runtime_ready "$ACTIVE_SLOT" leader; then
      compose_current up -d "api-${previous}" >/dev/null 2>&1 || true
      slot_runtime_ready "$previous" leader \
        || alert CRITICAL 'new leader failed and previous scheduler leader could not be restored'
      return 1
    fi
  else
    # A prior attempt may already have stopped/removed the old API. In that
    # case only a fully healthy active leader grants authority to continue.
    if ((STRUCTURAL_ONLY == 1)); then
      slot_structural_ready "$ACTIVE_SLOT" leader || return 1
    else
      slot_ready "$ACTIVE_SLOT" leader || return 1
    fi
  fi

  verify_present_slot_identity "$previous" || return 1
  state_save cleanup-handoff "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' '' cleanup-leader-handoff-complete || return 1

  previous_web="$(slot_container_id "web-${previous}")"
  [[ -z "$previous_web" ]] || compose_current stop "web-${previous}" || return 1
  compose_current rm -f "api-${previous}" "web-${previous}" || return 1
  [[ -z "$(slot_any_container_id "api-${previous}")" \
    && -z "$(slot_any_container_id "web-${previous}")" ]] || return 1

  if ! cleanup_legacy; then
    alert ERROR 'legacy cleanup was partial; cleanup handoff remains resumable'
    state_save cleanup-handoff "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
      "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
      application "$ACTIVE_SLOT" '' '' '' '' legacy-cleanup-partial || true
    return 1
  fi

  PREVIOUS_SLOT=''; CANDIDATE_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  state_save cleaned "$ACTIVE_SLOT" '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" \
    "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' cleanup-complete
}

discard_prepared_candidate() {
  local candidate="$CANDIDATE_SLOT" kind service
  is_slot "$ACTIVE_SLOT" && is_slot "$candidate" && [[ "$candidate" != "$ACTIVE_SLOT" \
    && -z "$PREVIOUS_SLOT" && -z "$STABLE_UNTIL" \
    && -z "$MONITOR_ACTIVE_SLOT" && -z "$MONITOR_ROLLBACK_SLOT" ]] \
    || return 1
  [[ "$GATEWAY_MODE" == application && "$GATEWAY_SLOT" == "$ACTIVE_SLOT" ]] \
    || return 1
  if ((STRUCTURAL_ONLY == 1)); then
    slot_structural_ready "$ACTIVE_SLOT" leader || return 1
  else
    slot_ready "$ACTIVE_SLOT" leader || return 1
  fi
  verify_present_slot_identity "$candidate" || return 1
  for kind in api web; do
    service="${kind}-${candidate}"
    [[ -z "$(slot_container_id "$service")" ]] \
      || compose_current stop "$service" || return 1
    [[ -z "$(slot_any_container_id "$service")" ]] \
      || compose_current rm -f "$service" || return 1
  done
  [[ -z "$(slot_any_container_id "api-${candidate}")" \
    && -z "$(slot_any_container_id "web-${candidate}")" ]] || return 1
  CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  state_save candidate-discarded "$ACTIVE_SLOT" '' '' \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' '' prepared-candidate-discarded
}

cleanup() {
  require_active_state
  cleanup_retired_images \
    || die 'run-scoped image retirement is incomplete but remains resumable'
  local now previous event; now="$(date +%s)"; previous="$PREVIOUS_SLOT"; event="$(state_get event)"
  case "$event" in
    preparing|prepare-failed|prepared|candidate-prepared)
      discard_prepared_candidate \
        || die 'prepared candidate cleanup is incomplete but remains resumable'
      log 'discarded prepared candidate; active slot remains unchanged'
      return 0
      ;;
    switching|switch-failed|monitor-failed)
      die 'coordinator switchback is required before cleanup'
      ;;
    rolled-back)
      is_slot "$previous" && [[ "$previous" != "$ACTIVE_SLOT" ]] \
        || die 'rolled-back state has no failed slot to clean'
      slot_runtime_ready "$ACTIVE_SLOT" leader || die 'restored slot is not leader before rollback cleanup'
      verify_present_slot_identity "$previous" || die 'failed slot identity is unknown; refusing rollback cleanup'
      [[ -z "$(slot_container_id "api-${previous}")" ]] \
        || compose_current stop "api-${previous}" || die 'could not stop failed API after switchback'
      [[ -z "$(slot_container_id "web-${previous}")" ]] \
        || compose_current stop "web-${previous}" || die 'could not stop failed Web after switchback'
      compose_current rm -f "api-${previous}" "web-${previous}" || die 'could not remove failed slot after switchback'
      [[ -z "$(slot_any_container_id "api-${previous}")" \
        && -z "$(slot_any_container_id "web-${previous}")" ]] \
        || die 'failed slot containers remain after rollback cleanup'
      if ! cleanup_legacy; then
        state_save rolled-back "$ACTIVE_SLOT" "$previous" "$previous" \
          "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
          application "$ACTIVE_SLOT" '' '' '' '' rollback-legacy-cleanup-partial || true
        die 'legacy cleanup was partial after switchback; rollback cleanup remains resumable'
      fi
      PREVIOUS_SLOT=''; CANDIDATE_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
      state_save rollback-cleaned "$ACTIVE_SLOT" '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' rollback-cleanup-complete
      log "rollback cleanup completed; ${ACTIVE_SLOT} remains scheduler leader"
      return 0
      ;;
  esac
  is_slot "$previous" || { log 'no previous slot to clean'; return 0; }
  if [[ "$event" != cleanup-handoff ]]; then
    [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && "$now" -ge "$STABLE_UNTIL" ]] \
      || die 'previous slot is still inside five-minute stability window'
  fi
  cleanup_previous_slot_transaction "$previous" \
    || die 'cleanup handoff is incomplete but remains resumable'
  log "cleaned ${previous} slot; ${ACTIVE_SLOT} confirmed scheduler leader; old containers removed and images retained"
}

reconcile() {
  load_state_context
  local event; event="$(state_get event)"
  cleanup_retired_images \
    || die 'run-scoped image retirement is incomplete but remains resumable'
  if ((RESTORE_LEGACY == 1)); then
    restore_legacy_after_phase3_stop || die 'legacy restore failed during reconcile; gateway maintenance was attempted'
    ACTIVE_SLOT=''; CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
    state_save legacy-restored '' '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" offline '' '' '' '' '' legacy-restored-by-operator
    alert WARNING 'legacy API/Web restored and Phase 3 services stopped by reconcile --restore-legacy'
    return 0
  fi
  if [[ "$event" == bootstrap-preparing || "$event" == bootstrapping || "$event" == bootstrap-failed ]]; then
    alert WARNING "reconcile recovering incomplete bootstrap (event=${event})"
    if restore_legacy_after_phase3_stop; then
      ACTIVE_SLOT=''; CANDIDATE_SLOT=''; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
      state_save legacy-restored '' '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" offline '' '' '' '' '' legacy-restored-after-incomplete-bootstrap
      alert WARNING 'legacy API/Web restored after incomplete bootstrap'
      log 'legacy API/Web restored after incomplete bootstrap'
      return 0
    fi
    state_save bootstrap-failed '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" maintenance '' '' '' '' incomplete-bootstrap gateway-maintenance-retained
    alert CRITICAL 'legacy restore failed after incomplete bootstrap; gateway maintenance retained'
    return 0
  fi
  if [[ "$event" == preparing || "$event" == prepare-failed \
    || "$event" == prepared || "$event" == candidate-prepared ]]; then
    alert WARNING "reconcile discarding interrupted inactive candidate (event=${event})"
    discard_prepared_candidate \
      || die 'interrupted candidate cleanup is incomplete but remains resumable'
    log 'interrupted inactive candidate discarded; active release remains unchanged'
    return 0
  fi
  case "$event" in
    switching|switch-failed|monitor-failed)
      die 'coordinator switchback is required; reconcile will not finalize an unverified candidate'
      ;;
  esac
  is_slot "$ACTIVE_SLOT" || die 'no active Phase 3 slot; use reconcile --restore-legacy'
  resource_guard
  assert_running_slot_images_match_state
  legacy_enforce_quarantine || die 'legacy services cannot be quarantined safely'
  if [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -ge STABLE_UNTIL && -n "$PREVIOUS_SLOT" ]]; then
    compose_current up -d "api-${ACTIVE_SLOT}" "web-${ACTIVE_SLOT}" "api-${PREVIOUS_SLOT}" "web-${PREVIOUS_SLOT}" gateway
    slot_ready "$ACTIVE_SLOT" standby || die 'active standby is not ready before expired-window cleanup'
    slot_runtime_ready "$PREVIOUS_SLOT" leader || die 'previous leader is not ready before expired-window cleanup'
    cleanup; load_state_context
  fi
  local expected_role=leader
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -lt STABLE_UNTIL && -n "$PREVIOUS_SLOT" ]] && expected_role=standby
  if [[ "$expected_role" == standby ]]; then
    assert_slot_state_images_trusted "$ACTIVE_SLOT" "$PREVIOUS_SLOT"
  else
    assert_slot_state_images_trusted "$ACTIVE_SLOT"
  fi
  compose_current up -d "api-${ACTIVE_SLOT}" "web-${ACTIVE_SLOT}" gateway
  if [[ "$expected_role" == standby ]]; then compose_current up -d "api-${PREVIOUS_SLOT}" "web-${PREVIOUS_SLOT}" || die 'previous leader could not start'; fi
  slot_ready "$ACTIVE_SLOT" "$expected_role" || die 'active slot did not pass readiness during reconcile'
  [[ "$expected_role" != standby ]] || slot_runtime_ready "$PREVIOUS_SLOT" leader || die 'previous scheduler leader is unhealthy during reconcile'
  render_gateway application "$ACTIVE_SLOT"; gateway_config_validate; gateway_reload; gateway_points_to "$ACTIVE_SLOT"; external_smoke || die 'gateway reconciliation smoke failed'
  state_save reconciled "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" '' reconciled
  spawn_stability_monitor
  log "reconciled active ${ACTIVE_SLOT} slot and legacy quarantine"
}

