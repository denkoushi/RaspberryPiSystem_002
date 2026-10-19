# SharePoint work-instruction ingestion and Raspberry Pi grouping

This living ExecPlan follows `.agent/PLANS.md`. Status: local implementation and validation complete. Owner: Codex orchestration with Luna Max domain, ingestion/API, and validation agents. Approved: 2026-08-29.

## Purpose / Big Picture

Power Automate sends one SharePoint row's complete current state as a JSON manifest plus its referenced images in one Gmail message. Raspberry Pi stores the newest row and combines rows by `part_number` and `shooting_target`. Operators can retrieve the combined instructions, source rows, images, and import results through authenticated APIs. There is no Power Automate cross-row merging, UI, AI/RAG integration, historical backfill, or deployment in this task.

## Progress

- [x] (2026-08-29) Read reference conversation, repository rules, current code, and current document contracts before planning.
- [x] (2026-08-29) User approved scope, grouping, scheduling, original images, latest-only retention, and processed-mail trash behavior.
- [x] (2026-08-29) Lifecycle audit and start created `feat/sharepoint-work-instructions` from `origin/main` at `7bb402be6b0f9fa98ee6b6614e53f66130c5e2fc`.
- [x] (2026-08-29) Domain, four database models, BIGINT migration, atomic replacement, cleanup and read repository.
- [x] (2026-08-29) Gmail packet ingestion, image lifecycle, five-minute scheduler, job handling and authenticated APIs.
- [x] (2026-08-29) Durable storage, Compose/Ansible, backup/DR, and associated Python contract tests (16 storage/materializer plus 5 DR policy tests passed).
- [x] (2026-08-29) Fresh isolated pgvector PostgreSQL migration, SQL/EXPLAIN, real filesystem/Gmail-mock/API integration, regressions, build and lint.
- [x] (2026-08-29) Review fixes, exact temporary-resource cleanup and responsibility report. No commit, push, PR or deployment was performed.

## Surprises & Discoveries

Existing CSV, Kiosk document, and assembly-document importers have different update and mail-disposal contracts. Their domain services are not suitable row-snapshot stores. Gmail transport, authentication, rate gates, `ImportJob`, leader-controlled schedulers, and the durable file store are reusable.

Actual PoC mail used `640_manifest.json`, not a fixed `manifest.json` filename. Small Gmail attachments may be in MIME `body.data` rather than behind `attachmentId`. The agreed `source` addition has not yet been verified in a real received message; test fixtures must include it without claiming live end-to-end success.

The existing local API test helper can stop an existing test container. Do not use it. Existing migration history requires pgvector. Storage is explicitly enumerated across Compose, Ansible, runtime preparation, backups and tests; adding only an application directory is insufficient.

The initial import-message scan used a fixed first 1000 history rows. Independent review found that old INVALID rows could hide a due RETRYABLE row, so fresh Gmail IDs are now looked up in 500-ID pages while due retry/acknowledgement work is queried independently and ordered oldest first. Cleanup also needed an atomic database claim: a separate list-then-mark flow could race asset activation.

Prisma `Int` could not represent the manifest contract's full JavaScript safe-positive-integer range. `sourceItemId` and `step` therefore use PostgreSQL/Prisma BIGINT and convert at the domain boundary with a safe-integer check. The group index includes source ordering columns. EXPLAIN still performs a tiny in-memory sort for the explicit `COLLATE "C"`, but uses `WorkInstructionRow_idx_group` for the filtered scan.

## Decision Log

Decision (2026-08-29, user): group by part number plus `shooting_target`, across lists. Normalize `研削`/`研削工程` together and `切削`/`切削工程` together. Keep individual resource codes separate from upper-level categories. Do not infer a resource from machine names or reuse production-schedule code-to-category classification.

Decision (2026-08-29, user): retain latest rows and original image bytes only, with import outcomes separately. Successful mail is marked read, labeled `rps_processed`, and trashed; existing nightly cleanup may permanently delete it.

Decision (2026-08-29, review): keep four models and calculate groups at read time. Immutable new asset paths plus a short database pointer switch provide consistency without holding database transactions during Gmail or disk I/O. Reuse `ImportJob` rather than introducing a new job framework.

Decision (2026-08-29, orchestration): dependencies flow from routes/scheduler to application services and pure domain rules; Gmail, database, and files are adapters. Existing large files receive wiring or early ownership checks only. No new package dependency is needed.

Decision (2026-08-29, review): the manifest parser uses a small strict manual JSON boundary instead of Zod. This preserves the complete raw JSON, including unknown producer attributes, without a schema transform or a new dependency. It accepts only schema version 1 and returns domain-specific validation errors; focused parser tests define the boundary.

Decision (2026-08-29, review): split persistence into transaction orchestration, repeatable-read projections and import-message state modules. Split ingestion selection, acknowledgement, job lifecycle and policy from the application service. The remaining repository/application files retain one cohesive transaction or use-case boundary rather than adding a generic framework.

## Outcomes & Retrospective

Local implementation is complete on `feat/sharepoint-work-instructions`. One row snapshot is validated and stored, rows are grouped on read across lists, original image bytes are preserved, revision/duplicate/stale/conflict rules are serialized per source, Gmail acknowledgement is recoverable without reapplying content, and API/storage/scheduler/backup wiring is present. Existing CSV and Kiosk mailbox paths skip dedicated work-instruction messages without losing their own batch capacity.

Fresh disposable PostgreSQL accepted all 163 migrations; the second deploy reported no pending migrations and status was up to date. Repository/Gmail/real-filesystem failure and concurrency suites passed 17 distinct tests after adding safe-BIGINT and image-to-text-only replacement cases. Fastify/Prisma/durable-file API integration passed 2 tests, including original bytes and default 401/device-key 200/VIEWER 403/ADMIN 200 authorization. Focused unit/regression runs passed 85 tests plus 15 assembly/CSV regressions. Changed TypeScript ESLint, API build, shell syntax, storage/DR contracts and `git diff --check` passed.

No commit, push, PR, merge, production migration, real Gmail mutation or deployment was performed. Live receipt after the Power Automate `source` addition remains unverified and is not represented as production acceptance.

## Context and Orientation

The repository is `/Users/tsudatakashi/RaspberryPiSystem_002`. The implementation worktree is `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--sharepoint-work-instructions`. All subsequent commands run in that worktree unless stated otherwise. Main and other worktrees must not be modified.

`apps/api/prisma/schema.prisma` defines persistence. `apps/api/src/services/work-instructions/` contains the new independent domain and adapters. `apps/api/src/routes/work-instructions/` exposes HTTP access. Gmail connection comes from `services/gmail/gmail-api-client.factory.ts`; durable bytes use `services/file-storage/durable-file-store.port.ts`. Scheduler wiring belongs in `bootstrap/start-post-listen-schedulers.ts` under the existing leader lifecycle. Configuration remains in the existing backup configuration system, with work-instruction ingestion disabled by default.

A snapshot means the complete state of one SharePoint row, not a changed-field patch. Source identity means `(source.system, source.list, source.item_id)`. Asset staging means recording an unpublished image before writing its immutable file. Publishing switches current database references only after all required files are durable.

## Plan of Work

### Milestone 1: Domain and database

Create pure manifest parsing, grouping normalization, canonical content hashing and revision comparison under `services/work-instructions/domain/`. Accept schema version 1, positive integer source item and step identifiers, optional image-free steps and empty steps. Reject duplicate step numbers. Keep the entire latest raw manifest. Require `source.modified` with a timezone; never substitute `date`, subject, filename, or mail timestamp. Normalize grouping with NFKC, trimming and uppercase; missing group keys are stored as unclassified rather than merged together.

Add `WorkInstructionRow`, `WorkInstructionStep`, `WorkInstructionAsset`, and `WorkInstructionImportMessage` with source-tuple, row/step, and Gmail-ID uniqueness and indexes for source/group lookups. An additive migration must not touch existing data. Newer source revisions replace all steps; removed steps and images disappear. Older revisions are stale; equal timestamp plus equal canonical manifest/image hashes is duplicate; equal timestamp with different content keeps the current row and records a conflict for that message.

The repository under `services/work-instructions/repositories/` reserves staged asset records, then atomically applies a prepared packet under a source-identity transaction advisory lock. Recheck revision after acquiring the lock. On publication mark referenced assets active and displaced assets delete-pending. Read groups in a repeatable-read snapshot, ordered by numeric source item ID, stable list name, then step. Preserve source metadata and original step in the output. Group membership is computed, so changed grouping attributes automatically move the row.

### Milestone 2: Ingestion, filesystem, and APIs

Build small application services and injectable Gmail/file adapters. Identify one manifest by JSON content, accepting names such as `640_manifest.json`. Resolve both attachment IDs and inline MIME data. Match referenced image filenames uniquely, decode JPEG/PNG/WebP for validity using existing Sharp, and persist the original bytes unchanged. Ignore unrelated attachments with warnings. Required missing/corrupt images invalidate only that packet; maintain the previous row and continue other messages.

Register a disabled-by-default five-minute scheduler inside the existing leader lifecycle. Read fresh configuration each cycle. Match complete leading tokens `[WORK-INSTRUCTION]` and `[WORK-INSTRUCTION-TEST]`. Add shared ownership checks before CSV/Kiosk parsing or mail cleanup. Preserve their other behavior. Extend the Gmail factory with an optional no-wait choice while preserving its existing default; rate-limit deferral schedules a later retry.

Process at most 20 eligible messages per cycle: reserve ten each for new and due retry messages, reuse unused slots, and prevent same-process overlapping cycles. Persist invalid/manual-only, retryable/due, applied, duplicate, stale and conflict outcomes. Persist pending mail acknowledgement independently, so failed label/trash operations retry without applying data again. Successful, duplicate and stale messages are marked read and trashed with the existing processed label.

After durable publication, delete obsolete files. On each five-minute cleanup retry delete-pending files and unreferenced staged assets abandoned for over one hour; do not delete active/current or actively written assets. A cleanup failure must not revert a successful row. Missing active bytes fail only the affected asset request and are logged.

Use the existing `ImportJob` table with a work-instruction type for asynchronous jobs. Under `/api/work-instructions`, expose POST `/ingest` (optional `messageId`, 202 plus job ID), GET `/ingest/jobs/:id`, `/ingest/messages`, `/groups`, `/group?partNumber=...&resource=...`, `/rows`, and `/assets/:id`. Lists are paginated. Import/result management requires ADMIN or MANAGER; content and original image reads accept ADMIN/MANAGER/VIEWER or a registered device key. Scope job reads to the dedicated type. Source row deletion in SharePoint has no notification contract and is not inferred; step/image removal within a new snapshot is supported.

### Milestone 3: Storage and operational contracts

Register `work-instruction-assets` as a durable namespace. Add matching normal/phase3/Mac Compose mounts and named volumes, Ansible storage contract and directory preparation, Dockerfile/runtime paths, backup recommendations/templates, backup scripts, Google Drive disaster-recovery allowlist, and contract tests. Retain existing capacity/integrity protections rather than adding a new storage framework. Validate existing change classification and amend it only if the actual changed paths are not classified correctly.

### Milestone 4: Isolated validation and review

The validation agent owns dependency setup, Prisma generation and the dedicated database to avoid races. Each implementation agent owns its small unit tests; independent integration tests exercise real PostgreSQL and file storage with mocked Gmail. The root reviews code and the evidence, returns defects with concrete advice, and completes documentation. Do not expand into adjacent refactors.

## Concrete Steps

Completed from the original repository:

    python3 -m scripts.git_lifecycle.cli audit --json
    python3 -m scripts.git_lifecycle.cli start --branch feat/sharepoint-work-instructions

In the dedicated worktree, install frozen dependencies if needed. Start a uniquely named `pgvector/pgvector:pg15` container with `-p 127.0.0.1::5432`, its own database and no existing mounts. Capture the created container ID and assigned port. Set `DATABASE_URL`, `FILE_STORAGE_ROOT`, and the backup configuration path to dedicated temporary resources for all test commands. Record actual commands/paths and results below after validation.

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec prisma migrate deploy
    pnpm --filter @raspi-system/api exec prisma migrate deploy
    pnpm --filter @raspi-system/api exec prisma migrate status
    pnpm --filter @raspi-system/api exec vitest run <focused test paths>
    pnpm --filter @raspi-system/api build

Execute SQL through `docker exec -i <created-ID> psql -U postgres -d <dedicated-db> -v ON_ERROR_STOP=1 < <host-SQL-path>`; a host path passed to psql `-f` inside the container will not work. Use two connections with a barrier for concurrent application tests. Run EXPLAIN (ANALYZE, BUFFERS) after ANALYZE on representative data for source identity and ordered group queries. Do not require index scans on tiny fixtures or disable sequential scans to manufacture success.

## Validation and Acceptance

Start with pure domain tests for aliases, distinct resource codes, multiple lists, unclassified rows, ordering, more than eight combined images, empty/text-only steps and revision decisions. Integration must demonstrate first import, text-only updates, image replacement/removal, group moves, duplicate/late/concurrent delivery, same-version conflict, broken attachments, filesystem failure, transaction rollback, stale staged files, old-image deletion failure, acknowledgement-only retry and unaffected other-mail progress. Authenticated Fastify requests must return grouped steps and byte-identical images; unauthorized reads/writes must fail.

Run selected existing CSV, Kiosk and assembly Gmail regression tests plus attachment collector/provider tests. Validate storage and volume materializer contracts, changed-file lint, API build, and applicable change-classifier contracts. Total local verification budget is 45 minutes including failure investigation. Do not repeat successful unchanged commands; a failed command may be retried once after a causal fix or justified transient issue. Report unrelated failures rather than changing unrelated code.

Completion requires evidence for the agreed behavior, no unintended main changes, no task-created Docker resources remaining, and an explicit statement that live Gmail/Power Automate and deployment were not performed. Explain each changed module's responsibility, dependency and test boundary; explain any unchanged monolithic wiring files receiving small additions.

## Idempotence and Recovery

All schema changes are additive and applied only to the disposable database during this task. No existing DB/container is modified. Capture Docker container/volume/network inventories before and after. A finally/trap removes only the successfully created container ID with its own volumes, and explicitly created networks if any; never prune or run a shared Compose down. Keep the feature worktree and uncommitted source changes for user review. Do not invoke lifecycle finish because there is no merged PR.

An incomplete packet leaves the current row intact. A completed database switch survives cleanup failure. Failed input can be corrected and retried through the manual API. The transport token and backup configuration are reused without logging secrets. Real-mail acceptance after source-field addition remains a separately disclosed gap, not a reason to block fixture-based implementation.

## Artifacts and Notes

Lifecycle start returned `worktree_created: true`, `main_sync: not_attempted`, no warnings, and base SHA `7bb402be6b0f9fa98ee6b6614e53f66130c5e2fc`. Existing other-worktree audit warnings were preserved, not repaired.

Root storage checks: `python3 -m unittest scripts.ci.tests.test_file_storage_contract scripts.deploy.tests.test_pi5_volume_materializer` passed 16 tests in 0.067s. `python3 -m unittest scripts.google_drive_dr.tests.test_source_policy` passed 5 tests in 0.013s after correcting a newly added assertion for macOS `/var` versus `/private/var` path representation. Production policy did not need alteration. `bash -n` passed for both backup scripts and runtime rehearsal. Total command time for these checks was under three seconds.

Existing change classification recognizes the edited paths. Changes to the runtime rehearsal and storage contract test under `scripts/ci` intentionally select the full CI suite; classification is not weakened. Local task-focused validation and subsequent hosted/full CI are separate evidence boundaries. No classifier implementation change is needed.

Disposable validation used `pgvector/pgvector:pg15` through `scripts/test/work-instructions-validation.sh`. The final migration/integration run used loopback port `63175` and container ID `6b599592306433f54966639c598e39bfe9e18c34e2fc6bebb1081f49bdd7ef30`; safe-BIGINT, API and text-only replacement follow-ups used independently named containers on ports `63195`, `63215`, `63229` and `63240`. Every captured container ID and its explicit volume was absent after the trap, and the final label/name inventories were empty. No network was created. Temporary file roots were removed by the same trap.

Database evidence: `prisma generate`, `prisma validate`, two `prisma migrate deploy` calls and `prisma migrate status` passed. The three real DB/Gmail-mock/filesystem suites initially passed 15 tests; the final repository suite passed 10 tests after safe-BIGINT and text-only replacement additions; the Fastify API suite passed 2 tests. EXPLAIN (ANALYZE, BUFFERS) used `WorkInstructionRow_unique_source` for source identity and `WorkInstructionRow_idx_group` for the grouped scan, with measured execution under 0.03 ms on the fixture data. This is index/shape evidence, not a production performance claim.

Final non-DB evidence: the focused work-instruction/Gmail-provider/Kiosk run passed 85 tests with 17 opt-in integration tests skipped because they had already passed against the disposable DB. Assembly/CSV regression passed 15 tests. Changed-file ESLint and `pnpm --filter @raspi-system/api build` passed. The first changed-file lint invocation failed only because zsh supplied newline-separated paths as one filename; rerunning once with `xargs` after that command-construction fix passed and required no source change.

## Interfaces and Dependencies

Use the strict domain manifest parser for the JSON boundary, Prisma/PostgreSQL for state and transactions, existing Sharp for image validation only, DurableFileStore for original bytes, Fastify for routes, and existing Gmail/ImportJob/scheduler facilities. Domain modules do not import Gmail, filesystem, or Prisma details. `prisma-work-instruction.repository.ts` owns stage/apply/GC transactions; `prisma-work-instruction-read-queries.ts` owns repeatable-read projections; `prisma-work-instruction-import-messages.ts` owns Gmail-ID locking and monotonic message state. Resolver/selector/policy/job-runner/acknowledger/file adapter/application services remain separate test boundaries. Concrete Prisma/Gmail/files are composed only in `work-instruction-service.factory.ts`; routes and scheduler share that singleton.

Revision note (2026-08-29): created after approved plan and dedicated worktree creation; implementation and local validation only are authorized.
