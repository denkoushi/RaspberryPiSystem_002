# SCAW Nonconformity Self-Inspection Operations Runbook

Status: active (implementation and production rollout complete)

Scope: local validation and production rollout boundaries for the daily `scawSTFUTEKIGO` full-CSV import.

The implementation plan is the detailed design source at [the SCAW nonconformity ExecPlan](../plans/scaw-nonconformity-self-inspection-execplan.md). This runbook is limited to repeatable operations, test evidence, and recovery. It does not authorize a production deployment.

## Purpose and responsibility split

The import receives one complete daily CSV from Gmail. `FFUTEKIGONO` is the global business key. A successful non-empty snapshot updates or inserts the typed current row, creates a revision only when normalized source content changes, and marks keys absent from that snapshot inactive. An absent key remains in current and in its revisions. A malformed or empty snapshot must not change current membership.

`FSEZONO` is stored as `manufacturingOrderNo`. The import-time enrichment resolves the production schedule's `FHINCD` to the nullable persisted `partNumber`. The normal read API queries current by the saved `partNumber`; it must not join production raw rows at read time. All 16 source columns are typed in current and revision tables, using semantic names such as `nonconformityNo` and `discoveredOn`, with `rawPayload` JSON retained for forward reuse. Quantity is PostgreSQL `NUMERIC`/Prisma `Decimal`; business dates are date-only.

The existing `CsvDashboardIngestRun` is the snapshot audit record. Do not add a second SnapshotRun table. Record source rows in the existing APPEND dashboard, record duplicate last-row-wins count in `rowsSkipped`, and keep the typed revision table without a retention deletion job.

The kiosk keeps every source case in the API and database but collapses repeated operator-facing content in the panel. Equality uses all currently displayed fields: discovery date, originating department, remarks, nonconformity content, disposition, both corrective-content fields, part name, and machine name after the same trim/line-ending treatment used for display. Source identity and other non-displayed fields are not equality fields. Any difference in a displayed field produces a separate card.

After a successful domain commit, delete that run's APPEND staging rows in bounded chunks as a best-effort cleanup. Keep the `CsvDashboardIngestRun`, raw CSV, duplicate/error audit, and typed revisions indefinitely; a cleanup failure must be logged and must not roll back the committed projection. Any broader raw-row retention cleanup remains a separately reviewed change and must not remove evidence needed for projection retry or snapshot audit.

## Safety boundaries

All local database checks must use a new loopback-only disposable PostgreSQL instance. Never point a migration, seed, fixture, or cleanup command at an operator `DATABASE_URL`, a Compose database, or the fixed `postgres-test-local` container.

Do not run `pnpm test:postgres:start`, `scripts/test/start-postgres.sh`, `scripts/test/stop-postgres.sh`, `docker system prune`, wildcard Docker removal, `git reset --hard`, or a down migration for this feature. The fixed Postgres helper can stop or remove a container that belongs to another task.

The existing safe wrapper `scripts/test/work-instructions-validation.sh` is reusable here. It creates a unique labelled container and volume, publishes only a dynamic `127.0.0.1` port, captures container/volume/network inventories, and removes only its own container/volume in an EXIT/INT/TERM cleanup path. It intentionally does not create a network: the database is reached through the loopback port on Docker's default bridge, so no existing network is modified. If a future check needs container-to-container traffic, it must create and remove a uniquely labelled network instead. The wrapper verifies `TEMP_RESOURCE_REMAINING=0` and reports inventory changes. The feature does not need another Docker helper.

## Branch and worktree lifecycle

Run lifecycle commands from the repository root before implementation or after a merge. The approved branch is `feat/scaw-nonconformity-self-inspection`.

    cd /Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--scaw-nonconformity-self-inspection
    python3 -m scripts.git_lifecycle.cli audit --json

For a new task, the lifecycle entry point is:

    python3 -m scripts.git_lifecycle.cli start --branch feat/scaw-nonconformity-self-inspection

Use the exact worktree path printed by `start`. Do not create a second linked worktree or edit `main` directly. Push, PR, merge, and deployment are separate approvals.

After an approved PR is merged, use the exact path and PR number:

    python3 -m scripts.git_lifecycle.cli finish --worktree <exact-worktree-path> --pr <number>
    python3 -m scripts.git_lifecycle.cli audit --json

Record the PR, merge SHA, target cleanup result, `main_sync`, and protected unrelated worktrees in the ExecPlan. A clean feature branch is not evidence of main integration or production rollout.

## Isolated PostgreSQL validation

Run the following from the repository root. The wrapper owns the database lifecycle. Its child command inherits an isolated `DATABASE_URL`; do not override that variable inside the command.

    scripts/test/work-instructions-validation.sh bash -lc '
      cd apps/api
      pnpm exec prisma validate
      pnpm exec prisma generate
      pnpm exec prisma migrate deploy
      pnpm exec prisma migrate status
      RUN_SCAW_DB_INTEGRATION=1 pnpm exec vitest run --reporter=dot \
        src/services/scaw-stfutekigo/sync.service.integration.test.ts
    '

The browser adapter tests do not need a database and can run separately from the repository root:

    pnpm --filter @raspi-system/web test -- \
      src/api/domains/self-inspection-nonconformities.test.ts \
      src/api/hooks/self-inspection-nonconformities.test.tsx \
      src/features/work-instructions/SelfInspectionNonconformityPanel.test.tsx \
      src/features/work-instructions/WorkInstructionViewerDialog.test.tsx \
      src/pages/kiosk/KioskSelfInspectionPage.test.tsx

If the implementation chooses another test directory, replace only the Vitest path with the exact new test path. The wrapper must still be the outer command. A successful run ends with the focused Vitest summary and `TEMP_RESOURCE_REMAINING=0`. `Database schema is up to date` is expected after `migrate status`.

Before adding SQL fixtures, confirm that the wrapper printed a unique container name, container ID, port, and temporary file-storage root. Load only synthetic rows or an explicitly approved local fixture. Do not copy production CSVs or secrets into the worktree or Docker volume.

For a migration candidate, run the expand-only and deploy contract checks after the isolated database check:

    scripts/deploy/validate-candidate-migrations.sh origin/main HEAD
    scripts/deploy/tests/test-postgres-role-boundaries.sh
    scripts/deploy/tests/test-production-database-wiring.sh

Run broader API tests only when CI classification or the changed contract requires them. A migration/schema change normally selects API and DB-infra CI surfaces.

## SQL invariants and EXPLAIN evidence

The typed current table must enforce global uniqueness on `nonconformityNo` (the normalized `FFUTEKIGONO`). The normal read shape is a selective lookup by the persisted part number and active flag:

    EXPLAIN (ANALYZE, BUFFERS)
    SELECT *
    FROM "ScawStfutekigoCurrent"
    WHERE "partNumber" = '<fixture FHINCD>'
      AND "isPresentInLatestSnapshot" = true
    ORDER BY "discoveredOn" DESC;

The expected plan is an index scan using `(partNumber, isPresentInLatestSnapshot, discoveredOn)`. Revision retrieval uses the key/time index:

    EXPLAIN (ANALYZE, BUFFERS)
    SELECT *
    FROM "ScawStfutekigoRevision"
    WHERE "nonconformityNo" = '<fixture key>'
    ORDER BY "observedAt" DESC;

The expected plan is an index scan on `(nonconformityNo, observedAt DESC)`. The full-snapshot absence update must use the run ID already written to incoming current rows; it does not require a staging key table:

    EXPLAIN (ANALYZE, BUFFERS)
    UPDATE "ScawStfutekigoCurrent"
    SET "isPresentInLatestSnapshot" = false,
        "lastAbsentAt" = now()
    WHERE "isPresentInLatestSnapshot" = true
      AND "lastEvaluatedIngestRunId" IS DISTINCT FROM '<successful run id>';

Capture the plan after `ANALYZE` with the fixture cardinality, execution time, buffer counts, and whether the expected index was chosen. A tiny fixture may legitimately use a sequential scan; in that case repeat with representative cardinality instead of claiming production performance. No production schedule join or raw `ProductNo` expression index belongs in the normal API plan.

## Test matrix and acceptance evidence

The focused API/domain tests must cover the following observable behavior:

1. A valid non-empty snapshot inserts all new keys, stores all 16 typed fields, stores `manufacturingOrderNo`, persists matched or null `partNumber`, and records the source ingest run.
2. Re-importing the same normalized content changes no revision count.
3. Changing one typed source field updates current and creates exactly one revision for that key.
4. A disappeared key remains in current/revision data but is inactive and is excluded from the normal active query.
5. A key that reappears becomes active again; a changed reappearance creates a revision.
6. Duplicate keys use the last CSV row by source ordinal, retain a durable duplicate count in `CsvDashboardIngestRun.rowsSkipped`, and do not violate the global unique constraint.
7. A missing Gmail message, malformed CSV, invalid required key, or empty CSV leaves the last successful current membership unchanged and records the failed run/error.
8. Retrying the same completed run is idempotent. Concurrent projection is serialized and an older run cannot overwrite a newer successful run.
9. Decimal quantity preserves exact numeric value, and timestamp-bearing date input hashes/stores as the same date-only value when the calendar date is unchanged.
10. The read API finds only active rows matching the requested saved `partNumber`, without a runtime production-schedule join.
11. The kiosk panel collapses rows with the same displayed fields and counts the collapsed cards without changing API or database cardinality; a different discovery date remains a separate card.

The integration evidence must include counts before and after each snapshot, `rowsProcessed`, `rowsSkipped`, current active/inactive counts, revision count, matched/unmatched `partNumber` count, and the three SQL plans above. Do not use a count-only assertion for the duplicate, revision, or inactive behavior.

## Rollout and recovery

The migration is additive and forward-only. Back up the production database through the standard release path, apply the migration with the migration role, run `migrate deploy` and `migrate status`, and verify the new unique constraint and indexes before enabling the import schedule. The old API image must remain usable against the expanded schema.

Keep the fixed daily schedule's initial `enabled` value exactly as defined by the implementation's fixed schedule definition; do not silently change it in the runbook. The fixed time is `10:35 JST` (`35 10 * * *` in the runner's Asia/Tokyo timezone). For the first production verification, hold the schedule at its implementation-defined initial state and run one manual import with an approved full CSV. Verify the ingest run is `COMPLETED`, the source row count, duplicate count, typed current rows, revision behavior, inactive rows, and matched/null `partNumber` values before enabling or continuing the schedule.

After the manual run passes, enable the schedule and monitor the next runs for missing source, zero or sharply reduced row count, duplicate count, projection failure, unmatched enrichment, and runtime. A missing source is a no-op; a failed or empty full snapshot must not hide existing current rows.

If the feature misbehaves, pause or disable its schedule and route reads back to the previous API image/feature path. Do not down-migrate or delete current/revision data. Correct the projection with a forward migration or replay a known-good completed ingest run, then re-run the isolated and manual checks. Revisions are indefinite by policy and must remain part of backup/restore verification.

## Troubleshooting and evidence

If the disposable run fails, let its trap finish, confirm the unique prefix has no container/volume/network residue, and retry with a new run ID. Never repair a failed temporary volume manually and never remove an unowned resource.

If `migrate status` reports a failed or unfinished migration, stop before any application rollout. Inspect `_prisma_migrations` in the disposable database, preserve the output, and fix the migration on the feature branch. If a role-boundary test fails, do not grant DDL to the application role; correct the migration-role path instead.

The implementation plan should link the final focused test output, SQL plans, cleanup line, migration validator result, and branch/PR lifecycle evidence. This runbook remains procedural and should not receive a second copy of the detailed design.

## References

- [SCAW nonconformity ExecPlan](../plans/scaw-nonconformity-self-inspection-execplan.md)
- [Safe disposable work-instruction PostgreSQL wrapper](../../scripts/test/work-instructions-validation.sh)
- [Candidate migration validator](../../scripts/deploy/validate-candidate-migrations.sh)
- [Google Drive disaster-recovery runbook: isolated PostgreSQL restore](./google-drive-disaster-recovery.md)
