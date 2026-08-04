# shellcheck shell=bash
# Source-only bootstrap, prepare, switch, rollback, and monitor lifecycle operations.

bootstrap() {
  ((CONFIRM_BOOTSTRAP == 1)) || die 'first bootstrap requires --confirm-bootstrap'
  ((ALLOW_LEGACY_HANDOFF == 1)) || die 'first bootstrap requires --allow-legacy-scheduler-handoff'
  if [[ -f "$STATE_FILE" ]]; then
    state_assert
    [[ "$(state_get event)" == bootstrap-failed || "$(state_get event)" == legacy-restored ]] \
      || die 'Blue/Green state already exists; use reconcile or status'
  fi
  resolve_images; validate_resource_evidence; secret_guard
  BLUE_API_IMAGE="$API_IMAGE"; BLUE_WEB_IMAGE="$WEB_IMAGE"; GREEN_API_IMAGE=''; GREEN_WEB_IMAGE=''
  BLUE_API_IMAGE_ID="$CANDIDATE_API_IMAGE_ID"; BLUE_WEB_IMAGE_ID="$CANDIDATE_WEB_IMAGE_ID"
  GREEN_API_IMAGE_ID=''; GREEN_WEB_IMAGE_ID=''
  ACTIVE_SLOT=''; CANDIDATE_SLOT=blue; PREVIOUS_SLOT=''; GATEWAY_MODE=offline; GATEWAY_SLOT=''
  legacy_capture || die 'legacy API/Web containers are missing; bootstrap refused'
  ((LEGACY_API_WAS_RUNNING == 1 && LEGACY_WEB_WAS_RUNNING == 1)) || die 'legacy API/Web must both be running before bootstrap'
  assert_legacy_port_ownership || die '80/443 are not owned exclusively by legacy Web'
  legacy_scheduler_readiness || die 'legacy API is not a healthy scheduler leader'
  MIGRATION_BASE_COMMIT=''; MIGRATION_CANDIDATE_COMMIT=''; MIGRATION_STATUS=not-checked
  MIGRATION_CHECKED_AT=''; MIGRATION_APPLIED_AT=''
  # Seal recovery authority before migration or any inactive-slot container is
  # started. SIGKILL cannot run traps, so takeover must be state-driven.
  state_save bootstrap-preparing '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' \
    offline '' '' '' '' '' bootstrap-recovery-authority-sealed
  arm_bootstrap_recovery
  render_gateway maintenance || bootstrap_failure 'gateway maintenance configuration could not be rendered'
  gateway_config_validate || bootstrap_failure 'gateway maintenance configuration is invalid'
  migration_apply_and_verify blue "$LEGACY_API_IMAGE" legacy \
    || { MIGRATION_STATUS=failed; bootstrap_failure 'candidate migration or compatibility failed'; }
  slot_up blue standby \
    || { phase3_stop_for_recovery || true; bootstrap_failure 'Blue candidate did not become scheduler standby'; }
  GATEWAY_MODE=maintenance; GATEWAY_SLOT=''
  state_save bootstrapping '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' maintenance '' '' '' '' '' preflight-complete
  legacy_enable_maintenance || bootstrap_failure 'legacy Web maintenance page did not become reachable'
  state_save bootstrapping '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' maintenance '' '' '' '' '' legacy-maintenance-verified
  legacy_quarantine || bootstrap_failure 'failed to quarantine legacy restart policies'
  state_save bootstrapping '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' maintenance '' '' '' '' '' legacy-quarantined
  legacy_stop || bootstrap_failure 'legacy API did not stop'
  scheduler_readiness blue leader || bootstrap_failure 'Blue API did not become scheduler leader after legacy stop'
  legacy_stop_web || bootstrap_failure 'legacy Web did not stop'; wait_host_ports_free || bootstrap_failure 'legacy Web did not release 80/443'
  gateway_start || bootstrap_failure 'gateway did not start'; maintenance_smoke || bootstrap_failure 'gateway maintenance page failed smoke'
  render_gateway application blue; gateway_config_validate; gateway_reload || bootstrap_failure 'gateway application reload failed'
  gateway_points_to blue && external_smoke || bootstrap_failure 'gateway application activation smoke failed'
  GATEWAY_MODE=application; GATEWAY_SLOT=blue
  state_save active blue '' '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" '' '' application blue '' '' '' '' bootstrap-success
  disarm_bootstrap_recovery
  log 'Blue/Green bootstrap completed; blue is active and legacy services are quarantined'
}

prepare() {
  require_active_state; require_no_stability_window
  cleanup_retired_images \
    || die 'previous run-scoped image retirement is incomplete; refusing another candidate'
  secret_guard; resolve_images; validate_resource_evidence
  seal_active_slot_image_ids
  verify_slot_identity "$ACTIVE_SLOT" || die 'active slot image does not match state; run reconcile'
  slot_runtime_ready "$ACTIVE_SLOT" leader || die 'active slot is not a healthy scheduler leader'
  local candidate displaced_api displaced_web displaced_api_id displaced_web_id
  candidate="$(other_slot "$ACTIVE_SLOT")"
  displaced_api="$(slot_api_image "$candidate")"
  displaced_web="$(slot_web_image "$candidate")"
  displaced_api_id="$(slot_api_image_id "$candidate")"
  displaced_web_id="$(slot_web_image_id "$candidate")"
  if [[ "$candidate" == blue ]]; then
    BLUE_API_IMAGE="$API_IMAGE"; BLUE_WEB_IMAGE="$WEB_IMAGE"
  else
    GREEN_API_IMAGE="$API_IMAGE"; GREEN_WEB_IMAGE="$WEB_IMAGE"
  fi
  set_slot_image_ids "$candidate" "$CANDIDATE_API_IMAGE_ID" "$CANDIDATE_WEB_IMAGE_ID"
  if [[ -n "$displaced_api" || -n "$displaced_web" \
    || -n "$displaced_api_id" || -n "$displaced_web_id" ]]; then
    if run_scoped_image_tag "$displaced_api" \
      || run_scoped_image_tag "$displaced_web"; then
      run_scoped_image_tag "$displaced_api" \
        && run_scoped_image_tag "$displaced_web" \
        && [[ "$displaced_api_id" =~ ^sha256:[0-9a-f]{64}$ \
          && "$displaced_web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || die 'displaced run-scoped image ownership is incomplete'
      if [[ "$displaced_api" == "$API_IMAGE" || "$displaced_web" == "$WEB_IMAGE" ]]; then
        [[ "$displaced_api" == "$API_IMAGE" && "$displaced_web" == "$WEB_IMAGE" \
          && "$displaced_api_id" == "$CANDIDATE_API_IMAGE_ID" \
          && "$displaced_web_id" == "$CANDIDATE_WEB_IMAGE_ID" ]] \
          || die 'candidate would retarget a durable run-scoped slot tag'
      else
        RETIRED_API_IMAGE="$displaced_api"; RETIRED_WEB_IMAGE="$displaced_web"
        RETIRED_API_IMAGE_ID="$displaced_api_id"; RETIRED_WEB_IMAGE_ID="$displaced_web_id"
      fi
    fi
  fi
  CANDIDATE_SLOT="$candidate"
  MIGRATION_BASE_COMMIT=''; MIGRATION_CANDIDATE_COMMIT=''; MIGRATION_STATUS=not-checked
  MIGRATION_CHECKED_AT=''; MIGRATION_APPLIED_AT=''
  # Candidate identity and cleanup authority become durable before the first
  # migration command or Compose start. A crash can therefore be taken over
  # without guessing which inactive workload belongs to this release.
  state_save preparing "$ACTIVE_SLOT" "$CANDIDATE_SLOT" '' \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' '' prepare-recovery-authority-sealed
  arm_prepare_recovery
  cleanup_retired_images \
    || prepare_failure 'displaced run-scoped image tags remain referenced or unverifiable'
  migration_apply_and_verify "$candidate" "$(slot_api_image "$ACTIVE_SLOT")" "$ACTIVE_SLOT" \
    || { MIGRATION_STATUS=failed; prepare_failure 'candidate migration or compatibility failed'; }
  slot_up "$candidate" standby \
    || prepare_failure "${SLOT_UP_FAILURE_REASON:-candidate ${candidate} did not become ready}"
  state_save prepared "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" '' '' '' '' candidate-prepared
  disarm_prepare_recovery
  log "candidate prepared in ${candidate} slot"
}

rollback_internal() {
  local target="$1" failed="$2" reason="$3"
  is_slot "$target" && is_slot "$failed" || return 1
  verify_slot_identity "$target" || return 1
  slot_runtime_ready "$target" leader || return 1
  render_gateway application "$target" || return 1
  gateway_config_validate && gateway_reload && gateway_points_to "$target" && external_smoke || return 1
  ACTIVE_SLOT="$target"; CANDIDATE_SLOT="$failed"; PREVIOUS_SLOT="$failed"
  GATEWAY_MODE=application; GATEWAY_SLOT="$target"; STABLE_UNTIL=''; MONITOR_ACTIVE_SLOT=''; MONITOR_ROLLBACK_SLOT=''
  state_save rolled-back "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$target" '' '' '' "$reason" rollback-success || return 1
  log "rollback completed: ${reason}"
}

switch_candidate() {
  require_active_state
  local candidate="$CANDIDATE_SLOT" previous="$ACTIVE_SLOT" started now stable
  is_slot "$candidate" || die 'candidate slot is missing; run prepare'
  [[ "$candidate" != "$previous" ]] || die 'candidate is already active'
  verify_durable_release_evidence "$candidate" \
    || die 'candidate release evidence changed or expired before traffic switch'
  verify_slot_identity "$previous" && verify_slot_identity "$candidate" || die 'slot images do not match durable state'
  slot_runtime_ready "$previous" leader || die 'previous slot is not scheduler leader'
  slot_ready "$candidate" standby || die 'candidate is not scheduler standby'
  started="$(date +%s)"
  state_save switching "$previous" "$candidate" "$previous" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$previous" '' '' '' '' switching
  if ! render_gateway application "$candidate" \
    || ! gateway_config_validate \
    || ! gateway_reload \
    || ! gateway_points_to "$candidate" \
    || ! external_smoke; then
    state_save switch-failed "$previous" "$candidate" "$previous" \
      "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
      application "$previous" '' '' '' 'gateway or external smoke failed' switchback-required \
      || alert CRITICAL 'switch failed and failure evidence could not be persisted'
    die 'switch failed; coordinator switchback is required'
  fi
  now="$(date +%s)"; stable=$((now + STABLE_SECONDS))
  ACTIVE_SLOT="$candidate"; CANDIDATE_SLOT="$previous"; PREVIOUS_SLOT="$previous"
  STABLE_UNTIL="$stable"; MONITOR_ACTIVE_SLOT="$candidate"; MONITOR_ROLLBACK_SLOT="$previous"; GATEWAY_SLOT="$candidate"
  if ! state_save active "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" '' "success:$((now-started))s"; then
    alert CRITICAL 'gateway switched but durable state save failed; coordinator switchback is required'
    die 'switch failed after gateway cutover because durable state could not be saved; coordinator switchback is required'
  fi
  log "switch completed; ${candidate} is public standby and ${previous} remains scheduler leader until ${stable}"
}

rollback() {
  require_active_state
  local event target failed
  event="$(state_get event)"
  [[ "$event" != cleanup-handoff ]] \
    || die 'scheduler handoff is committed; only idempotent cleanup may continue'
  if [[ "$event" == switching || "$event" == switch-failed ]]; then
    target="$ACTIVE_SLOT"
    failed="$CANDIDATE_SLOT"
    [[ "$PREVIOUS_SLOT" == "$target" ]] || die 'switchback authority is malformed'
  else
    target="$PREVIOUS_SLOT"
    failed="$ACTIVE_SLOT"
  fi
  is_slot "$target" && is_slot "$failed" && [[ "$target" != "$failed" ]] \
    || die 'no complete switchback authority is recorded'
  rollback_internal "$target" "$failed" "${ROLLBACK_REASON:-coordinator runtime switchback}" \
    || { alert CRITICAL 'coordinator-requested switchback failed; routing left unchanged'; die 'runtime switchback failed'; }
}

monitor_checks() {
  local active="$1" rollback_slot="$2" samples="$3" force_structural="${4:-0}" error_rate
  if ((force_structural == 1 || samples == 1 || (samples - 1) % MONITOR_STRUCTURAL_SAMPLE_INTERVAL == 0)); then
    if ((STRUCTURAL_ONLY == 1)); then
      slot_structural_ready "$active" standby || return 1
    else
      slot_ready "$active" standby || return 1
    fi
    slot_runtime_ready "$rollback_slot" leader || return 1
  else
    # Scheduler/database readiness and the public API/Web path are still
    # checked every two seconds. Only immutable structure checks are amortized.
    scheduler_readiness "$active" standby || return 1
    scheduler_readiness "$rollback_slot" leader || return 1
  fi
  external_smoke || return 1
  if [[ -n "$ERROR_RATE_URL" && "$samples" -ge "$MIN_ERROR_SAMPLES" && "$DRY_RUN" != 1 ]]; then
    error_rate="$(curl -kfsS --max-time 5 "$ERROR_RATE_URL" | python3 -c '
import json, math, sys
def pairs(items):
    result={}
    for key,value in items:
        if key in result: raise ValueError("duplicate JSON key")
        result[key]=value
    return result
d=json.load(sys.stdin, object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
value=d.get("errorRate",d.get("error_rate")) if isinstance(d,dict) else None
if type(value) not in (int,float) or not math.isfinite(value) or not 0 <= value <= 1: raise SystemExit(1)
print(value)
')" || return 1
    awk "BEGIN {exit !($error_rate <= $MAX_ERROR_RATE)}" || return 1
  fi
}

monitor() {
  [[ -f "$STATE_FILE" ]] || return 0
  local deadline active rollback_slot event samples=0 now
  while :; do
    load_state_context
    event="$(state_get event)"
    case "$event" in
      active|reconciled) ;;
      monitor-passed) return 0 ;;
      monitor-failed) return 1 ;;
      *) return 1 ;;
    esac
    deadline="$STABLE_UNTIL"; active="$MONITOR_ACTIVE_SLOT"; rollback_slot="$MONITOR_ROLLBACK_SLOT"
    [[ "$deadline" =~ ^[0-9]+$ ]] || return 0
    is_slot "$active" && is_slot "$rollback_slot" || return 0
    now="$(date +%s)"
    if ((now >= deadline)); then
      samples=$((samples + 1))
      if ! monitor_checks "$active" "$rollback_slot" "$samples" 1; then
        alert CRITICAL "stability monitor failed for ${active}; coordinator switchback is required"
        state_save monitor-failed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
          "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
          application "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" \
          'stability monitor final sample failure' switchback-required \
          || alert CRITICAL 'monitor failure evidence could not be persisted'
        return 1
      fi
      state_save monitor-passed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
        "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
        application "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" \
        '' stability-monitor-complete
      return 0
    fi
    samples=$((samples + 1))
    if ! monitor_checks "$active" "$rollback_slot" "$samples"; then
      alert CRITICAL "stability monitor failed for ${active}; coordinator switchback is required"
      state_save monitor-failed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
        "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
        application "$GATEWAY_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" "$MONITOR_ROLLBACK_SLOT" \
        'stability monitor threshold failure' switchback-required \
        || alert CRITICAL 'monitor failure evidence could not be persisted'
      return 1
    fi
    sleep "$MONITOR_INTERVAL"
  done
}

# A coordinator takeover cannot count an interval in which its monitor was not
# known to be alive. Restart a complete five-minute window, durably, before the
# recovery coordinator invokes `monitor` synchronously.
restart_stability_window() {
  ((STRUCTURAL_ONLY == 1)) \
    || die 'stability monitor restart is reserved for coordinator recovery'
  require_active_state
  local event previous stable
  event="$(state_get event)"; previous="$PREVIOUS_SLOT"
  [[ "$event" == active || "$event" == reconciled ]] \
    || die 'only an interrupted active stability window can be restarted'
  is_slot "$previous" && [[ "$previous" != "$ACTIVE_SLOT" \
    && "$CANDIDATE_SLOT" == "$previous" \
    && "$MONITOR_ACTIVE_SLOT" == "$ACTIVE_SLOT" \
    && "$MONITOR_ROLLBACK_SLOT" == "$previous" ]] \
    || die 'interrupted stability window state is malformed'
  [[ "$GATEWAY_MODE" == application && "$GATEWAY_SLOT" == "$ACTIVE_SLOT" ]] \
    || die 'interrupted stability window gateway is malformed'
  slot_structural_ready "$ACTIVE_SLOT" standby \
    || die 'active candidate is not a healthy standby during monitor takeover'
  slot_runtime_ready "$previous" leader \
    || die 'previous scheduler leader is unhealthy during monitor takeover'
  external_smoke || die 'public smoke failed during monitor takeover'
  stable=$(($(date +%s) + STABLE_SECONDS))
  STABLE_UNTIL="$stable"
  state_save active "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" "$STABLE_UNTIL" "$MONITOR_ACTIVE_SLOT" \
    "$MONITOR_ROLLBACK_SLOT" '' recovery-stability-window-restarted
  log "restarted continuous stability monitor until ${stable}"
}

spawn_stability_monitor() {
  [[ "$DRY_RUN" == 1 ]] && return 0
  [[ "$STABLE_UNTIL" =~ ^[0-9]+$ ]] || return 0
  (( $(date +%s) < STABLE_UNTIL )) || return 0
  is_slot "$MONITOR_ACTIVE_SLOT" && is_slot "$MONITOR_ROLLBACK_SLOT" || return 0
  nohup sh -c "sleep 1; exec '$SCRIPT_PATH' monitor" >>"${STATE_FILE}.monitor.log" 2>&1 &
  log "stability monitor (re)started until ${STABLE_UNTIL}"
}
