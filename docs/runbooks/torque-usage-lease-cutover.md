# Torque usage lease cutover

`TorqueWrenchUsageLease` is the only runtime current-lease backend after the
forward cutover. The legacy `TorqueWrenchConnectionLease` table remains for
expand-only migration safety, but runtime reads and writes to it are removed.

## Forward

1. Stop every torque-agent and browser-to-Pi3 connection request.
2. Stop all legacy API acquire, heartbeat/renew, takeover, and ownership-update
   writers. Run a pre-probe against each old writer route/process and save the
   HTTP status/body and timestamp. The probe command must exit 0 only when the
   request is rejected or the old process is unreachable. Use valid request
   bodies and save each response; for example, this probe exits 0 only for
   connection failure (000) or the explicit stopped-writer statuses (410/503):
   `probe(){ status=$(curl -sS --connect-timeout 2 -o old-writer-probe.json -w '%{http_code}' -X POST http://old-api/torque-wrenches/PROFILE/connection-lease/acquire -H 'content-type: application/json' -d "$VALID_ACQUIRE_BODY" || printf 000); case "$status" in 000|410|503) return 0;; *) return 1;; esac; }; probe`.
3. Wait the 8 second TTL plus the handoff grace period.
4. Run `TORQUE_CUTOVER_EVIDENCE_DIR=/var/log/torque-cutover/20260809 \
   TORQUE_CUTOVER_WRITERS_STOPPED=1 DATABASE_URL=... \
   TORQUE_LEGACY_WRITER_PROBE_PRE='...' \
   TORQUE_LEGACY_WRITER_PROBE_POST='...' \
   scripts/torque-training/cutover-usage-lease.sh forward`.
   Both probes are mandatory; the script saves their output and exit status in
   `TORQUE_CUTOVER_EVIDENCE_DIR` along with the SQL transcript. The
   script takes NOWAIT table locks, checks active=0, copies, validates, and
   commits as one DB transaction. A lock conflict aborts closed.
5. Start the API build that uses only `TorqueWrenchUsageLease`; verify assembly
   acquire/renew/release and the new training acquire path before restarting
   torque-agent.

6. Repeat the old-writer probe after the commit and save its result before any
   new backend is started. The old and new API writers must never be started
   together. The script's SQL evidence, probe output, and service logs are the
   cutover record.

## Rollback

Stop agents and all new API acquire/renew/takeover writers, run a new-writer
pre-probe, wait TTL plus grace, then run
`TORQUE_CUTOVER_EVIDENCE_DIR=/var/log/torque-cutover/20260809-rollback \
TORQUE_CUTOVER_WRITERS_STOPPED=1 DATABASE_URL=... \
TORQUE_NEW_WRITER_PROBE_PRE='...' TORQUE_NEW_WRITER_PROBE_POST='...' \
scripts/torque-training/cutover-usage-lease.sh rollback`.
Rollback takes the new table NOWAIT lock and aborts unless new active count is
zero; the new writer probe must show rejection/unreachable both before and after.
Start the old backend alone, verify assembly, then restart the agent.
Training sessions are completed or cancelled first and remain stored.
