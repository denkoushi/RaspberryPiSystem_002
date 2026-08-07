# shellcheck shell=bash
# Source-only migration ledger, expand-only verification, and recovery helpers.

migration_applied_checksums() {
  local candidate="$1"
  compose_current run --rm --no-deps "api-${candidate}" sh -lc \
    'PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -AtF "|" -c "SELECT migration_name, checksum FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"'
}

# Hidden, read-only observation used by the coordinator's fleet evidence path.
# It deliberately requires a normalized live release and queries the active API
# container instead of trusting migration files from the mutable checkout.
live_migration_ledger() {
  [[ "$DRY_RUN" != 1 ]] || die 'live migration evidence is unavailable in dry-run mode'
  require_active_state
  [[ -z "$CANDIDATE_SLOT" && -z "$PREVIOUS_SLOT" && -z "$STABLE_UNTIL" \
    && -z "$MONITOR_ACTIVE_SLOT" && -z "$MONITOR_ROLLBACK_SLOT" ]] \
    || die 'live migration evidence requires normalized Blue/Green state'
  [[ "$GATEWAY_MODE" == application && "$GATEWAY_SLOT" == "$ACTIVE_SLOT" ]] \
    || die 'live migration evidence requires the active application gateway'
  verify_slot_identity "$ACTIVE_SLOT" \
    || die 'live migration evidence requires the sealed active slot'
  slot_runtime_ready "$ACTIVE_SLOT" leader \
    || die 'live migration evidence requires a healthy scheduler leader'
  local container
  container="$(slot_container_id "api-${ACTIVE_SLOT}")"
  [[ -n "$container" ]] || die 'active API container is unavailable for migration evidence'
  docker exec "$container" sh -lc \
    'PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -AtF "|" -c "SELECT migration_name, checksum FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"' \
    || die 'could not read the live applied Prisma migration ledger'
}

verify_migration_plan() {
  local candidate="$1" base_image="$2" candidate_image candidate_ref base_ref ledger plan_data
  candidate_image="$(slot_api_image "$candidate")"
  if [[ "$DRY_RUN" == 1 && "${PI5_BLUE_GREEN_TEST_ALLOW_MISSING_RELEASE_EVIDENCE:-0}" == 1 ]]; then
    MIGRATION_CANDIDATE_COMMIT="$(image_commit "$candidate_image" 2>/dev/null || true)"
    MIGRATION_BASE_COMMIT="$MIGRATION_CANDIDATE_COMMIT"
    MIGRATION_STATUS=checked
    MIGRATION_CHECKED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    MIGRATION_APPLIED_AT=''
    return 0
  fi
  candidate_ref="$(image_commit "$candidate_image")" || die 'candidate image tag is not an immutable commit/config tag'
  base_ref="$(image_commit "$base_image")" || die 'live compatibility image is not bound to an immutable base commit'
  ledger="$(mktemp "${TMPDIR:-/tmp}/pi5-blue-green-ledger.XXXXXX")"
  chmod 600 "$ledger"
  if ! migration_applied_checksums "$candidate" >"$ledger"; then
    rm -f "$ledger"
    die 'could not re-read the applied migration ledger'
  fi
  if [[ -n "$MIGRATION_PLAN_FILE" ]]; then
    [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$ ]] \
      || die '--run-id is required with --migration-plan'
    if ! plan_data="$(python3 "$RELEASE_EVIDENCE_HELPER" verify-migration \
      --path "$MIGRATION_PLAN_FILE" --run-id "$RUN_ID" --sha "$candidate_ref" --ledger "$ledger")"; then
      rm -f "$ledger"
      die 'migration plan is stale, tampered, or the applied ledger changed'
    fi
    MIGRATION_BASE_COMMIT="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["baseSha"])' <<<"$plan_data")"
    [[ "$MIGRATION_BASE_COMMIT" == "$base_ref" ]] \
      || die 'migration plan base no longer matches the live compatibility image'
  else
    MIGRATION_BASE_COMMIT="$base_ref"
  fi
  rm -f "$ledger"
  MIGRATION_CANDIDATE_COMMIT="$candidate_ref"
  MIGRATION_STATUS=checked; MIGRATION_CHECKED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"; MIGRATION_APPLIED_AT=''
}

migration_apply_and_verify() {
  local candidate="$1" base_image="$2" compatibility_slot="$3"
  local applied_ledger
  verify_migration_plan "$candidate" "$base_image" || return 1
  if [[ "$DRY_RUN" != 1 ]]; then
    # The API image has `node dist/main.js` as its default command.  Use an
    # explicit shell and the installed Prisma binary so Compose does not try to
    # execute `npx` through that Node command during bootstrap/prepare.
    compose_migration run --rm --no-deps "api-${candidate}" sh -lc \
      'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate deploy' || return 1
    compose_migration run --rm --no-deps "api-${candidate}" sh -lc \
      'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate status' || return 1
    applied_ledger="$(mktemp "${TMPDIR:-/tmp}/pi5-blue-green-applied.XXXXXX")" || return 1
    chmod 600 "$applied_ledger"
    if ! migration_applied_checksums "$candidate" >"$applied_ledger" \
      || ! migration_gate_verify_applied_ledger \
        "$PROJECT_DIR" "$MIGRATION_BASE_COMMIT" "$MIGRATION_CANDIDATE_COMMIT" "$applied_ledger"; then
      rm -f "$applied_ledger"
      return 1
    fi
    rm -f "$applied_ledger"
    if [[ "$compatibility_slot" == legacy ]]; then legacy_scheduler_readiness || return 1
    else slot_runtime_ready "$compatibility_slot" leader || return 1
    fi
  fi
  MIGRATION_STATUS=applied; MIGRATION_APPLIED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
}

assert_running_slot_images_match_state() {
  local slot api_cid web_cid
  [[ "$DRY_RUN" == 1 ]] && return 0
  for slot in blue green; do
    api_cid="$(slot_container_id "api-${slot}")"; web_cid="$(slot_container_id "web-${slot}")"
    if [[ -n "$api_cid" || -n "$web_cid" ]]; then
      [[ -n "$(slot_api_image "$slot")" && -n "$(slot_web_image "$slot")" ]] || die "running ${slot} containers exist but state has incomplete images; refusing compose up"
      verify_slot_identity "$slot" || die "running ${slot} images do not match Blue/Green state; refusing compose up (possible rewritten state)"
    fi
  done
}

assert_slot_state_images_trusted() {
  local slot api_image web_image api_id web_id
  for slot in "$@"; do
    is_slot "$slot" || die "invalid state slot while validating images: ${slot}"
    api_image="$(slot_api_image "$slot")"; web_image="$(slot_web_image "$slot")"
    [[ -n "$api_image" && -n "$web_image" ]] || die "state has incomplete ${slot} image pair; refusing compose up"
    validate_image_pair "$api_image" "$web_image"
    if [[ "$DRY_RUN" != 1 ]]; then
      api_id="$(slot_api_image_id "$slot")"; web_id="$(slot_web_image_id "$slot")"
      [[ "$api_id" =~ ^sha256:[0-9a-f]{64}$ && "$web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || die "state has no sealed ${slot} image IDs; refusing compose up"
      [[ "$(docker image inspect -f '{{.Id}}' "$api_image" 2>/dev/null || true)" == "$api_id" \
        && "$(docker image inspect -f '{{.Id}}' "$web_image" 2>/dev/null || true)" == "$web_id" ]] \
        || die "state image tag was retargeted for ${slot}; refusing compose up"
    fi
  done
}

arm_bootstrap_recovery() {
  BOOTSTRAP_RECOVERY_ARMED=1
  trap 'rc=$?; if ((BOOTSTRAP_RECOVERY_ARMED==1)); then bootstrap_failure "unexpected bootstrap exit (${rc})"; fi' ERR
  trap 'if ((BOOTSTRAP_RECOVERY_ARMED==1)); then bootstrap_failure "bootstrap interrupted by signal"; fi' INT TERM HUP
}
disarm_bootstrap_recovery() { BOOTSTRAP_RECOVERY_ARMED=0; trap - ERR INT TERM HUP; }

arm_prepare_recovery() {
  PREPARE_RECOVERY_ARMED=1
  trap 'rc=$?; if ((PREPARE_RECOVERY_ARMED==1)); then prepare_failure "unexpected prepare exit (${rc})"; fi' ERR
  trap 'if ((PREPARE_RECOVERY_ARMED==1)); then prepare_failure "prepare interrupted by signal"; fi' INT TERM HUP
}
disarm_prepare_recovery() { PREPARE_RECOVERY_ARMED=0; trap - ERR INT TERM HUP; }

prepare_failure() {
  local reason="$1"
  trap - ERR EXIT INT TERM HUP; PREPARE_RECOVERY_ARMED=0; set +e
  alert ERROR "Blue/Green candidate preparation failed: ${reason}; durable candidate cleanup is required"
  state_save prepare-failed "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$PREVIOUS_SLOT" \
    "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    application "$ACTIVE_SLOT" '' '' '' "$reason" prepare-failed || true
  lock_cleanup; set -e; die "candidate prepare failed: $reason"
}

bootstrap_failure() {
  local reason="$1" restored=0 gateway_mode=offline
  trap - ERR EXIT INT TERM HUP; BOOTSTRAP_RECOVERY_ARMED=0; set +e
  alert CRITICAL "Blue/Green bootstrap failed: ${reason}; restoring legacy API/Web"
  if restore_legacy_after_phase3_stop; then
    restored=1
    alert WARNING 'legacy API/Web restoration completed after bootstrap failure'
  else
    gateway_mode=maintenance
  fi
  state_save bootstrap-failed '' blue '' "$BLUE_API_IMAGE" "$BLUE_WEB_IMAGE" "$GREEN_API_IMAGE" "$GREEN_WEB_IMAGE" \
    "$gateway_mode" '' '' '' '' "$reason" "legacy-restored=${restored}" || true
  lock_cleanup; set -e; die "bootstrap failed: $reason"
}

require_active_state() { load_state_context; is_slot "$ACTIVE_SLOT" || die 'active slot is missing'; }
require_no_stability_window() {
  if [[ "$STABLE_UNTIL" =~ ^[0-9]+$ && $(date +%s) -lt STABLE_UNTIL ]]; then die 'stability window is active; rollback or wait before prepare'; fi
}
