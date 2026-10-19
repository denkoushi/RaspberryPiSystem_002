#!/usr/bin/env bash
set -euo pipefail

# This is an operator-gated stop-the-world cutover. It never writes the legacy
# table and refuses to run without an explicit writer-stop acknowledgement and
# probes that prove the stopped backend rejects writer requests.
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${TORQUE_CUTOVER_EVIDENCE_DIR:?TORQUE_CUTOVER_EVIDENCE_DIR is required for saved probe/SQL evidence}"
mkdir -p "$TORQUE_CUTOVER_EVIDENCE_DIR"
if [[ "${TORQUE_CUTOVER_WRITERS_STOPPED:-}" != "1" ]]; then
  echo "Set TORQUE_CUTOVER_WRITERS_STOPPED=1 only after torque-agent and every old API acquire/heartbeat/takeover writer is stopped." >&2
  exit 2
fi

run_required_probe() {
  local name="$1"
  local command="${2:-}"
  if [[ -z "$command" ]]; then
    echo "$name writer-stop probe is required" >&2
    exit 2
  fi
  local log="$TORQUE_CUTOVER_EVIDENCE_DIR/${name}.log"
  echo "running $name writer-stop probe (evidence: $log)"
  if bash -lc "$command" >"$log" 2>&1; then
    printf 'probe_exit=0 timestamp=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$log"
  else
    local status=$?
    printf 'probe_exit=%s timestamp=%s\n' "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$log"
    cat "$log" >&2
    return "$status"
  fi
  echo "$name writer-stop probe passed"
}

mode="${1:-forward}"
case "$mode" in
  forward)
    run_required_probe "legacy-pre" "${TORQUE_LEGACY_WRITER_PROBE_PRE:-}"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | tee "$TORQUE_CUTOVER_EVIDENCE_DIR/sql-forward.log"
BEGIN;
LOCK TABLE "TorqueWrenchConnectionLease" IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE "TorqueWrenchUsageLease" IN SHARE ROW EXCLUSIVE MODE NOWAIT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TorqueWrenchUsageLease") THEN
    RAISE EXCEPTION 'new usage lease table is not empty; cutover is not a first cutover';
  END IF;
END $$;

SELECT COUNT(*) = 0 AS writers_stopped
FROM "TorqueWrenchConnectionLease"
WHERE "releasedAt" IS NULL AND "expiresAt" > now();
\gset
\if :writers_stopped
\else
\echo 'legacy active lease is not zero; cutover aborted'
DO $$ BEGIN RAISE EXCEPTION 'legacy active lease is not zero'; END $$;
\endif

-- Preserve all released/expired legacy current rows. No legacy row is updated
-- or deleted; the new table becomes the sole runtime backend after commit.
INSERT INTO "TorqueWrenchUsageLease" (
  "torqueWrenchProfileId", "leaseId", "generation", "requestId", "ownerKind",
  "ownerAssemblySessionId", "ownerTrainingSessionId", "adoptedConfirmationId",
  "ownerClientDeviceId", "acquiredAt", "renewedAt", "expiresAt", "connectAfter",
  "releasedAt", "releaseReason", "updatedAt"
)
SELECT old."torqueWrenchProfileId", old."leaseId", old."generation", old."requestId", 'ASSEMBLY',
       old."ownerSessionId", NULL, old."adoptedConfirmationId", old."ownerClientDeviceId",
       old."acquiredAt", old."renewedAt", old."expiresAt", old."connectAfter",
       COALESCE(old."releasedAt", now()), COALESCE(old."releaseReason", 'CUTOVER_RELEASED'), now()
FROM "TorqueWrenchConnectionLease" old
WHERE (old."releasedAt" IS NOT NULL OR old."expiresAt" <= now());

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "TorqueWrenchConnectionLease")
     <> (SELECT COUNT(*) FROM "TorqueWrenchUsageLease") THEN
    RAISE EXCEPTION 'legacy/new profile count mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "TorqueWrenchConnectionLease" old
    LEFT JOIN "TorqueWrenchUsageLease" new
      ON new."torqueWrenchProfileId" = old."torqueWrenchProfileId"
    WHERE new."torqueWrenchProfileId" IS NULL
       OR new."generation" <> old."generation"
       OR new."leaseId" <> old."leaseId"
  ) THEN
    RAISE EXCEPTION 'legacy/new generation or lease identity mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TorqueWrenchUsageLease"
    WHERE "releasedAt" IS NULL
       OR "ownerKind" <> 'ASSEMBLY'
       OR "ownerAssemblySessionId" IS NULL
       OR "ownerTrainingSessionId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'new cutover row is not a released assembly owner';
  END IF;
END $$;
COMMIT;

SELECT COUNT(*) AS legacy_active_after
FROM "TorqueWrenchConnectionLease"
WHERE "releasedAt" IS NULL AND "expiresAt" > now();
SQL
    run_required_probe "legacy-post" "${TORQUE_LEGACY_WRITER_PROBE_POST:-}"
    ;;
  rollback)
    run_required_probe "new-pre" "${TORQUE_NEW_WRITER_PROBE_PRE:-}"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | tee "$TORQUE_CUTOVER_EVIDENCE_DIR/sql-rollback.log"
BEGIN;
LOCK TABLE "TorqueWrenchUsageLease" IN SHARE ROW EXCLUSIVE MODE NOWAIT;
SELECT COUNT(*) = 0 AS new_active_zero
FROM "TorqueWrenchUsageLease"
WHERE "releasedAt" IS NULL AND "expiresAt" > now();
\gset
\if :new_active_zero
\else
\echo 'new active lease is not zero; rollback aborted'
DO $$ BEGIN RAISE EXCEPTION 'new active lease is not zero'; END $$;
\endif
COMMIT;
SQL
    run_required_probe "new-post" "${TORQUE_NEW_WRITER_PROBE_POST:-}"
    ;;
  *)
    echo "usage: $0 [forward|rollback]" >&2
    exit 2
    ;;
esac
