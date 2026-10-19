# SCAW nonconformity import and self-inspection display

This ExecPlan is a living document. Maintain it in accordance with `.agent/PLANS.md` while the work is in progress.

## Purpose / Big Picture

Import the daily full `scawSTFUTEKIGO` Gmail CSV through the existing CSV-dashboard route, preserve typed current and revision data, enrich cases from the production schedule by manufacturing order number, and show matching active cases from the work-instruction viewer without reducing the photo area when the panel is closed.

## Progress

- [x] (2026-09-02) Audited `main` and created linked worktree `feat/scaw-nonconformity-self-inspection` from `origin/main` at `d7a3592cf596442ac1435834a847c3d7f5936cbe`.
- [x] (2026-09-02) Added the additive Prisma migration, typed Current/Revision models, pure normalizer, enrichment adapter, and transactional synchronizer.
- [x] (2026-09-02) Registered dashboard `3b1a4089-3274-448b-9f4e-ec20c294fe27`, exact subject `scawSTFUTEKIGO`, and protected daily `35 10 * * *` schedule.
- [x] (2026-09-02) Added the authenticated read API and an initially collapsed, independently scrolling kiosk panel.
- [x] (2026-09-02) Passed focused API/Web tests, lint, typecheck, builds, all migrations, two real-PostgreSQL synchronization scenarios, 8,188-row projection, SQL invariants, and three query plans.
- [x] (2026-09-02) Updated `docs/runbooks/scaw-nonconformity-self-inspection.md` and `docs/INDEX.md`.
- [x] (2026-09-02) Created local implementation commit `f7ae0419`; did not push, open a PR, merge, migrate production, consume Gmail, or deploy.
- [x] (2026-09-03) Merged PR #1318 as `d5ee18c9a3f0df3106dfa800d7f8beea7e3cf309` after required CI, CodeQL, and gitleaks succeeded; completed lifecycle cleanup.
- [x] (2026-09-03) Deployed the exact merge SHA to Pi5 with standard release run `20260902-214302-c18c36`; migration/status, five health samples, route switch, scheduler handoff, and rollback readiness succeeded.
- [x] (2026-09-03) Imported the unread Gmail snapshot through the fixed schedule: 8,188 processed/added, zero skipped, 8,188 Current, 8,188 Revision, zero duplicate business keys, 83 resolved and 8,105 retained unmatched rows.
- [x] (2026-09-03) Approved a follow-up kiosk presentation rule: repeated operator-facing content is shown once while all source cases remain available in the API and database.

## Surprises & Discoveries

- Observation: PR #1318's first API coverage run passed the tests but failed the global function threshold by 0.03 points (`75.97%` versus `76%`).
  Evidence: CI run `33682063509` failed only `api (all)`; DB, Web, kiosk-SOP, container rehearsal, CodeQL, gitleaks, and repository checks passed. Added direct tests for the fixed-schedule invariant, advisory lock, bounded staging deletion, and zero-progress cleanup without lowering the threshold or changing production code.
- Observation: The source contains decimal quantities, including `0.1` and `0.2`, so quantity must use `Decimal`, not an integer.
  Evidence: PostgreSQL validation retained `0.200000` in `DECIMAL(18,6)`.
- Observation: Most historical manufacturing orders are not in the current production schedule; unmatched source rows must remain durable and retryable.
  Evidence: The source analysis found only 109 of 3,983 order numbers in the current schedule.
- Observation: Generic dashboard DEDUP cannot model full-snapshot disappearance or reliable same-day source changes.
  Evidence: The domain integration test required an explicit latest-membership flag and separate content revisions.
- Observation: PostgreSQL sorts nulls first for descending order unless told otherwise.
  Evidence: The snapshot guard therefore reads the maximum non-null persisted `lastSnapshotReceivedAt` instead of ordering nullable ingest timestamps.
- Observation: The representative API lookup uses the new composite index; the bulk inactive update intentionally scans 8,190 rows because the approved index set excludes a run-marker index.
  Evidence: API bitmap index scan completed in 0.641 ms; revision index scan in 0.035 ms; rollback-only inactive update in 70.664 ms.

## Decision Log

- Decision: Use the existing `CsvDashboardIngestRun` as snapshot audit and add only Current and Revision domain tables.
  Rationale: This keeps ingestion audit in the existing subsystem while preserving durable business data for later classification or RAG.
  Date/Author: 2026-09-02 / Codex and user-approved plan.
- Decision: Use APPEND dashboard rows as staging and delete only the successfully evaluated run in 500-row chunks after the domain transaction commits.
  Rationale: Retry evidence remains until success, while daily staging growth is bounded without coupling domain history to generic JSON retention.
  Date/Author: 2026-09-02 / Codex and user-approved plan.
- Decision: Treat only `FFUTEKIGONO` as the canonical case key. `FSEZONO` is the production-schedule `ProductNo` enrichment key and `FFUTEKIGOHINCD` is a quality-assurance identifier, not a part number.
  Rationale: This follows the confirmed business meanings and prevents incorrect kiosk matches.
  Date/Author: 2026-09-02 / user.
- Decision: Keep the read API independent from production-schedule rows and return only persisted enrichment from active Current rows.
  Rationale: Historical cases remain readable even after schedule rows disappear, and kiosk reads stay predictable.
  Date/Author: 2026-09-02 / Codex and user-approved plan.
- Decision: Reject missing headers, empty snapshots, malformed rows, and blank `FFUTEKIGONO` without changing Current; tolerate invalid non-empty dates or quantities as null with warnings.
  Rationale: Membership changes require a trustworthy full snapshot, while one optional typed-value defect must not block thousands of valid cases.
  Date/Author: 2026-09-02 / Codex and user-approved plan.
- Decision: Match the fixed Gmail subject by trimmed, case-insensitive equality while retaining existing partial matching for all other dashboards.
  Rationale: Similar subjects such as `scawSTFUTEKIGO_backup` must not replace the authoritative full snapshot.
  Date/Author: 2026-09-02 / Codex review.
- Decision: Collapse kiosk cards only when all displayed fields, including discovery date, are equal.
  Rationale: Repeated text tied to separate manufacturing orders is valid source data but repeating it in the operator panel adds workload without improving recurrence prevention. API and database rows remain individual for audit and analysis.
  Date/Author: 2026-09-03 / user-approved follow-up.

## Outcomes & Retrospective

The local implementation scope is complete. A synthetic 8,188-row full snapshot produced exactly 8,188 unique Current rows and revisions in 4.084 seconds, then removed only that run's staging rows. Functional PostgreSQL tests proved last-row-wins duplicates, unchanged re-imports without revisions, changed revisions, disappearance, same-content reappearance, and delayed older-snapshot rejection. The kiosk query and panel are separated from image rendering, so loading or failure of nonconformity data does not hide the work-instruction photos. On 2026-09-03 the user authorized continuation through production deployment; repository integration, the canonical rolling release, and production verification are therefore now active milestones and must be evidenced before this plan is complete.

## Context and Orientation

The existing import pipeline is `GmailStorageProvider` to `CsvDashboardImportService`, then `CsvDashboardIngestor`, then `CsvDashboardPostIngestService`. The first component downloads unread attachments, the ingestor maps CSV headers to semantic JSON and records a `CsvDashboardIngestRun`, and post-ingest performs domain-specific projections before the Gmail message is read and trashed. Those files live under `apps/api/src/services/backup` and `apps/api/src/services/csv-dashboard`. Fixed schedules live under `apps/api/src/services/imports` and execute cron expressions in the application's Asia/Tokyo timezone.

The source has 16 fields. `FKIINBUSHOCD` and `FBUSHOMEI` are the originating department code/name; `FFUTEKIGOSU` is a unitless decimal quantity; `FBIKO`, `FFUTEKIGONAIYO`, `FZESEINAIYO1`, `FZESEINAIYO2`, and `FSHOTINAIYO` are separate text fields; `FHAKKENYMD`, `FUPDTEDT`, and `FSHOTIYMD` are date-only after parsing; `FSEZONO` is the manufacturing-order key; `FSEIBAN` is the source seiban; `FFUTEKIGOHINCD` is the quality-assurance code; `FFUTEKIGONO` is the globally unique nonconformity number; and `FZUMENNO` is the drawing number. `FSEZONO` resolves to production schedule `ProductNo`, from which `FHINCD`, `FHINMEI`, `FSEIBAN`, and the existing machine-name resolver provide persisted kiosk enrichment.

Prisma schema and migrations are under `apps/api/prisma`. The new `ScawStfutekigoCurrent` table retains active and absent cases, first/last observation metadata, the last source/evaluation runs, typed fields, exact `rawPayload`, and a hash of normalized source content. `ScawStfutekigoRevision` adds a row only on creation or normalized source-content change. The kiosk scan starts in `apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx`, where the work-instruction hook resolves aliases to a canonical part number. That canonical value drives the new query hook and is passed into `WorkInstructionViewerDialog`.

## Plan of Work

Milestone 1 creates the durable projection. Add the migration and `apps/api/src/services/scaw-stfutekigo` modules. The normalizer owns NFKC identifier normalization, LF text normalization, date/Decimal parsing, validation, duplicate-last-row selection, and hashing without I/O. The production adapter owns the existing schedule winner condition and machine-name lookup. The synchronizer owns the advisory lock, one domain transaction, Current/Revision writes, membership changes, delayed-snapshot guard, and post-commit staging cleanup. Verify with the focused unit tests and real PostgreSQL integration test.

Milestone 2 connects ingestion and scheduling. Ensure the fixed APPEND dashboard by ID with 16 named columns and exact subject filtering, propagate Gmail `internalDate` through `sourceReceivedAt`, process messages oldest first, and add the protected 10:35 schedule. `CsvDashboardPostIngestService` contains only the fixed-ID dispatch; all business logic remains in the domain module. Verify schedule, Gmail ordering, exact-subject, error-policy, and post-ingest tests.

Milestone 3 exposes and displays cases. Register `GET /api/kiosk/self-inspection/nonconformities`, authorize it with the same kiosk key or `ADMIN`, `MANAGER`, and `VIEWER` JWT roles, normalize its part number like work instructions, and query active Current rows without a runtime schedule join. On the web, keep HTTP state in `useSelfInspectionNonconformities`, rendering state in `SelfInspectionNonconformityPanel`, canonical-part orchestration in `KioskSelfInspectionPage`, and only presentation props in `WorkInstructionViewerDialog`. Verify authentication, ordering, response shape, scan changes, loading/error isolation, accessibility attributes, field separation, and image-dialog layering.

Milestone 4 validates and hands off. Deploy all migrations into a disposable loopback-only PostgreSQL container, exercise 8,188 rows, inspect constraints and query plans, run focused tests/lint/typechecks/builds, verify Docker cleanup, update this plan and the runbook, and make one local commit. Do not push or deploy.

## Concrete Steps

From `/Users/tsudatakashi/RaspberryPiSystem_002`, audit and start the branch with `python3 -m scripts.git_lifecycle.cli audit --json` and `python3 -m scripts.git_lifecycle.cli start --branch feat/scaw-nonconformity-self-inspection`. Work only in the returned linked worktree. Run focused tests with `pnpm --filter @raspi-system/api test -- <changed API tests>` and `pnpm --filter @raspi-system/web test -- <changed Web tests>`. Run API/Web lint, build the two required shared packages followed by API and Web, and validate Prisma.

For database proof, run `scripts/test/work-instructions-validation.sh` with a child command that performs `prisma migrate deploy`, `prisma migrate status`, and `RUN_SCAW_DB_INTEGRATION=1 vitest run src/services/scaw-stfutekigo/sync.service.integration.test.ts`. The expected result is two passing tests, one with 8,188 Current and Revision rows, followed by `TEMP_RESOURCE_REMAINING=0`. Seed 8,190 synthetic rows in a second disposable run, execute `ANALYZE`, then the three `EXPLAIN (ANALYZE, BUFFERS)` queries documented in the runbook. Run the expand-only validator against the committed branch. Finally inspect `git diff --check`, commit locally, and stop.

## Validation and Acceptance

Acceptance requires idempotent daily snapshots, revision creation only for source-content changes, inactive retention for disappeared cases, safe preservation of the last valid snapshot after malformed input, persisted order-to-part enrichment, an all-period active-case API, and a non-blocking accessible kiosk panel. The API must never return `rawPayload`. The panel must initially be closed, show each distinct operator-facing content set once with its fields kept separate, leave the photo grid unchanged while closed, and keep image enlargement above it. API and UI failures must not prevent work-instruction photos from rendering.

## Idempotence and Recovery

Snapshot application uses a PostgreSQL advisory lock and one database transaction. Reprocessing the same run is a no-op. A failed projection leaves current membership unchanged and retains staging/raw evidence. Docker validation uses unique labels/names and an EXIT/INT/TERM cleanup trap; it never invokes fixed-name test-container cleanup or `docker system prune`. Production rollback, if later authorized, pauses the schedule and uses a forward correction or replay rather than a destructive down migration.

## Artifacts and Notes

Evidence produced on 2026-09-02:

- `prisma validate`, `prisma generate`, all 168 `prisma migrate deploy` migrations, and `prisma migrate status` succeeded in a disposable PostgreSQL 15/pgvector container.
- PostgreSQL integration: 2 tests passed; functional snapshot behavior took 109 ms and the 8,188-row projection took 4.084 seconds.
- SQL fixture: 8,190 Current rows, 8,190 distinct nonconformity numbers, 8,190 revisions, decimal `0.200000`, and date-only maximum `2026-09-02`.
- Query plans: Current lookup used `ScawStfutekigoCurrent_part_active_discovered_idx` and completed in 0.641 ms; revision lookup used `ScawStfutekigoRevision_no_changed_idx` in 0.035 ms; rollback-only inactive update scanned 8,190 rows and completed in 70.664 ms.
- Both disposable runs ended with `TEMP_RESOURCE_REMAINING=0`; pre-existing container, volume, and network inventories were not modified.
- Focused API tests passed across 68 distinct cases, and focused Web tests passed across 45 cases. API and Web lint, Prisma generation, API TypeScript build, and production Web Vite build also passed; the commit hook repeated the full workspace lint successfully.
- `scripts/deploy/validate-candidate-migrations.sh origin/main HEAD` passed against implementation commit `f7ae0419`, including checksums for every already-applied migration and the new expand-only candidate migration.

## Interfaces and Dependencies

The new public interface is `GET /api/kiosk/self-inspection/nonconformities?partNumber=<canonical FHINCD>`, authenticated like work-instruction reads. Domain code depends inward on repository and enrichment ports; Prisma, production-schedule lookup, Gmail scheduling, HTTP routing, and React Query remain outer adapters.

Revision note (2026-09-02): Expanded the original implementation outline into a self-contained execution record; recorded the completed milestones, database evidence, exact-subject and timestamp-ordering review corrections, local implementation commit, and migration-candidate preflight result.
