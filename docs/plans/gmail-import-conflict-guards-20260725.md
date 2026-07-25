---
status: in_progress
scope: Gmail CSV imports and assembly procedure document Gmail import
date: 2026-07-25
source_of_truth: this execution plan
related_code:
  - apps/api/src/services/backup/gmail-request-gate.service.ts
  - apps/api/src/services/backup/storage/gmail-storage.provider.ts
  - apps/api/src/services/imports/csv-import-scheduler.ts
  - apps/api/src/services/assembly/assembly-procedure-gmail-import.service.ts
  - apps/web/src/pages/kiosk/KioskAssemblyPage.tsx
related_docs:
  - .agent/PLANS.md
  - docs/decisions/ADR-20260724-assembly-procedure-gmail-import.md
  - docs/guides/gmail-setup-guide.md
  - docs/knowledge-base/KB-391-gmail-csv-import-reliability.md
validation: local_passed
open_items:
  - implement and validate all milestones
---

# Prevent Gmail import conflicts without blocking non-Gmail work

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must remain current as work proceeds.
This document is maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

An operator can continue to import one assembly procedure document from Gmail by pressing
the kiosk button while scheduled CSV imports remain reliable. If a Gmail-backed CSV import
is already running, the procedure import returns HTTP 409 before it creates a Gmail client
or changes data, and the kiosk says `CSV自動取込中です。少し待ってから再実行してください。`.
If the procedure import starts first, both workflows may continue, but their individual
Google Gmail API requests run fairly one at a time. PDF conversion and database work remain
parallel so a long document conversion does not hold the CSV workflow.

The system also prevents an administrator from configuring a CSV subject fragment that
could match the reserved exact subject `DocumentASM`. This is enforced both when settings
are saved and immediately before a Gmail search, so old or directly edited database values
cannot consume a procedure-document message.

## Progress

- [x] (2026-07-25 10:02Z) Confirmed a clean `main`, fast-forwarded it from `origin/main`,
  and created `fix/gmail-import-conflict-guards`.
- [x] (2026-07-25 10:02Z) Re-read repository safety, architecture, test, Git, UI, and
  ExecPlan rules and re-located the current Gmail, CSV scheduler, assembly, and web boundaries.
- [x] (2026-07-25 10:37Z) Added regression tests and a pure reserved-subject policy used by every CSV configuration
  and runtime Gmail-search path.
- [x] (2026-07-25 10:37Z) Added a process-wide FIFO Gmail request serializer and integrated it into the cooldown gate.
- [x] (2026-07-25 10:37Z) Tracked effective Gmail CSV executions and rejected assembly Gmail import before side effects.
- [x] (2026-07-25 10:37Z) Updated the kiosk and administration error behavior and the relevant operational documents.
- [x] (2026-07-25 10:41Z) Passed focused and full API/Web tests, route-level API tests, package lint/build, deploy contracts, and isolated PostgreSQL migration/SQL/EXPLAIN validation; every exact-name temporary Docker resource was removed.
- [ ] Publish a pull request, obtain all required green checks, merge, and deploy the exact
  merged SHA through the standard rolling Blue/Green workflow.
- [ ] Record production validation and complete this plan.

## Surprises & Discoveries

- Observation: Gmail cooldown state is already shared through PostgreSQL, but each
  `GmailRequestGateService` instance currently invokes its Google request independently.
  Evidence: `GmailRequestGateService.execute()` calls `fn()` directly after the cooldown check.

- Observation: scheduled and manually triggered CSV imports both use `CsvImportScheduler`,
  while assembly creates a separate Gmail client and does not consult scheduler state.
  Evidence: `CsvImportScheduler.runImport()` and cron callbacks use `runningImports`, but
  `AssemblyProcedureGmailImportService` only has its own process-local `isRunning` guard.

- Observation: CSV subject matching is a case-insensitive substring match, so the fragment
  `ASM` can consume an exact `DocumentASM` message and must be treated as a conflict.
  Evidence: the CSV Gmail path normalizes both subject and configured pattern and uses
  `includes()`.

- Observation: save-time validation must check the effective stored subject during a
  partial update, not only a newly supplied `pattern` field. Otherwise a directly inserted
  reserved value could survive a priority, enabled, or name update.
  Evidence: focused service tests now cover partial updates of both
  `CsvImportSubjectPattern` and the legacy `CsvDashboard.gmailSubjectPattern`.

- Observation: the existing `CsvImportSubjectPattern_importType_idx` remains the selected
  access path with the reservation policy implemented in application code.
  Evidence: isolated PostgreSQL 15 with all 153 migrations used a Bitmap Index Scan for a
  20,000-row enabled-pattern lookup and completed in 0.041 ms; the fixture transaction was
  rolled back to zero rows.

## Decision Log

- Decision: serialize only individual Gmail API requests, not complete imports.
  Rationale: this prevents simultaneous calls and rate-limit bursts while allowing PDF
  conversion and CSV database work to proceed concurrently.
  Date/Author: 2026-07-25 / Codex, confirmed by user.

- Decision: reject every CSV pattern that could match the exact reserved subject under the
  current substring rule, after Unicode NFC normalization, trimming, and case folding.
  Rationale: rejecting exact text only would leave fragments such as `ASM` unsafe.
  Date/Author: 2026-07-25 / Codex.

- Decision: expose CSV activity through a narrow read-only port rather than importing the
  concrete scheduler class into the assembly domain service.
  Rationale: the assembly logic only needs one fact and should remain replaceable in tests
  and in a future multi-process deployment.
  Date/Author: 2026-07-25 / Codex.

- Decision: make the runtime subject guard fail before `gmail.users.messages.list`.
  Rationale: configuration validation can be bypassed by old data or direct SQL, so the
  destructive boundary must remain protected independently.
  Date/Author: 2026-07-25 / Codex.

- Decision: do not add a schema migration or a status polling endpoint.
  Rationale: process-local coordination satisfies the current one-active-API architecture,
  and the existing kiosk request/error surface already supports a clear 409 response.
  Date/Author: 2026-07-25 / Codex.

## Outcomes & Retrospective

Implementation and production validation are pending.

## Context and Orientation

`apps/api/src/services/assembly/assembly-procedure-gmail-import.service.ts` implements the
operator-triggered `DocumentASM` flow. It searches unread inbox messages, validates one PDF
or JPEG attachment, creates a draft procedure document, and trashes only successfully
persisted or duplicate messages. `apps/api/src/routes/assembly/index.ts` exposes it at
`POST /api/assembly/procedure-documents/ingest-gmail`.

`apps/api/src/services/imports/csv-import-scheduler.ts` is the singleton scheduler and manual
CSV execution entry point. A Gmail CSV schedule may delegate to
`apps/api/src/services/backup/gmail-import-orchestrator.ts`, which serializes complete
scheduled CSV cycles. This serialization does not include the assembly flow.

`apps/api/src/services/backup/gmail-api-client.ts` wraps every Google Gmail method with
`GmailRequestGateService.execute()`. The gate in
`apps/api/src/services/backup/gmail-request-gate.service.ts` checks and persists a shared
429 cooldown. A FIFO serializer means a first-in-first-out queue: requests enter one ordered
line, only the request at the front runs, and completion or failure releases the next.

CSV subject configuration exists in three compatibility paths. The primary table is managed
by `apps/api/src/services/imports/csv-import-subject-pattern.service.ts`. Legacy dashboard
settings are managed by `apps/api/src/services/csv-dashboard/csv-dashboard.service.ts`.
Schedule target fallbacks are managed by the import schedule administration service. The
runtime Gmail query is built in
`apps/api/src/services/backup/storage/gmail-storage.provider.ts`. All four boundaries must
consult one pure policy module.

The web kiosk already calls `readAssemblyApiErrorMessage()` from
`apps/web/src/features/assembly/assemblyUiHelpers.ts`. Administration pages currently use
generic mutation-failure text in some paths and need to surface the API message near the
failed input.

## Plan of Work

First add a Gmail-common reserved-subject module. It owns the canonical `DocumentASM` text,
normalization, a pure predicate, and a typed error carrying
`GMAIL_SUBJECT_PATTERN_RESERVED`. Assembly imports the same canonical constant. CSV subject
pattern create/update, dashboard create/update, and schedule configuration create/update
validate non-empty Gmail subject values. `GmailStorageProvider` repeats the same validation
before creating a query or invoking its Gmail client.

Next add a small `GmailRequestSerializer` interface with `runExclusive<T>()` and a
process-wide FIFO implementation. `GmailRequestGateService` receives this interface by
dependency injection and defaults to the shared process instance. Cooldown checks and waits
occur outside the exclusive slot. After acquiring the slot, the gate rechecks cooldown
because another queued request may have observed a 429. The Google call, 429 classification,
cooldown calculation, and cooldown persistence all remain inside the slot. Every return or
throw releases the slot.

Then add a `CsvImportActivityReader` interface with `isCsvImportRunning(): boolean`.
`CsvImportScheduler` counts active Gmail-backed executions in `try/finally` for both cron and
manual paths. The assembly factory injects a reader adapter over the singleton scheduler.
`AssemblyProcedureGmailImportService.ingest()` checks its existing duplicate-click guard,
then the CSV reader, and throws a typed 409 before resolving Gmail dependencies. A race in
which CSV begins just after admission remains safe because request-level serialization is
the final concurrency guard.

Finally preserve the kiosk's existing request-time behavior with a regression test and make
both CSV administration surfaces display the server's reserved-subject explanation. Update
the assembly ADR, Gmail setup guide, and Gmail reliability KB by linking to this plan for
detailed evidence rather than duplicating the same validation transcript.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`. Node 22 or newer is
required. On this Mac, prepend the bundled Node 24 directory returned by the Codex workspace
dependency loader to `PATH` and use pnpm 9.15.9.

Implement focused tests before or with each module, then run:

    pnpm --filter @raspi-system/api test -- <focused API test paths>
    pnpm --filter @raspi-system/web test -- <focused web test paths>

For database validation, create uniquely named temporary resources using
`pgvector/pgvector:pg15`. Do not connect tests to existing containers or databases. Install
an EXIT, INT, and TERM cleanup trap that removes only the exact temporary container, volume,
and network. Apply every migration, run Prisma migration status, insert reserved-subject
fixtures only inside a transaction that is rolled back, and run
`EXPLAIN (ANALYZE, BUFFERS)` for the enabled subject-pattern lookup. After validation, prove
the exact temporary resource names are absent.

Then run the repository-equivalent API and web test suites, lint, build, deploy-contract
checks, documentation checks, and `git diff --check`. Commit coherent milestones, push this
branch, and open a pull request. Wait for CI, CodeQL, secret scanning, and review gates.

After merge, identify the exact immutable `main` SHA. Run:

    scripts/update-all-clients.sh <exact-main-sha> infrastructure/ansible/inventory.yml --print-plan

Review every blocker and warning, perform the documented read-only preflight, and only then
run the same standard workflow without `--print-plan`. Never invoke Ansible, SSH update
scripts, or Blue/Green helper scripts directly. Use `--status <runId>` to verify completion.

## Validation and Acceptance

Pure policy tests must reject `DocumentASM`, `documentasm`, surrounding whitespace, and
`ASM`, while accepting every currently deployed CSV subject. Service and route tests must
show HTTP 400 with `GMAIL_SUBJECT_PATTERN_RESERVED` across all save paths and prove a legacy
or directly inserted collision stops before `messages.list`.

Serializer tests must observe a maximum active Google request count of one, FIFO order,
release after success, ordinary error, timeout, and 429, no next request before cooldown
persistence completes, and no exclusive slot held during a cooldown sleep.

Assembly tests must observe HTTP 409 with `ASSEMBLY_PROCEDURE_GMAIL_CSV_BUSY`, the exact
Japanese operator message, and zero Gmail search, attachment, or procedure persistence calls
while CSV is active. Existing oldest-first, ten-message limit, duplicate, success-trash, and
failure-retention tests must still pass.

The full application must lint, build, and pass tests without a Prisma schema diff. The
isolated PostgreSQL migration status must be current, the explain plan must use the existing
subject-pattern access path without a new sequential performance regression, and all
temporary Docker resources must be absent afterward.

Production acceptance requires API health 200, exactly one scheduler leader, no active Gmail
cooldown, no stale `PROCESSING` history, normal completion of subsequent CSV cycles, and a
passing Phase12 verifier. No production Gmail message or CSV subject configuration is
created or modified for testing.

## Idempotence and Recovery

All source edits are confined to `fix/gmail-import-conflict-guards` until review. Existing
worktree differences are never stashed or discarded automatically. The temporary database
uses unique names and exact-name cleanup so repeating validation cannot affect user data.
There is no database migration. Before deployment, rollback is simply abandoning the branch;
after deployment, rollback uses the standard workflow with the immediately preceding image.

If a deployment is started and must stop, use only
`scripts/update-all-clients.sh --cancel <runId> --reason <reason>`. Do not kill processes,
delete locks, or edit fleet state.

## Artifacts and Notes

Baseline before implementation:

    branch: main
    SHA: 8ce0028398d6b4245fd4384656d1aefcdb22cb88
    API focused tests: 2 files, 12 tests passed
    web focused tests: 1 file, 3 tests passed

The production subject patterns observed before this work do not collide with
`DocumentASM`: `計測機器持出状況`, `加工機日常点検結果`,
`生産日程_三島_研削工程`, `CustomerSCAW`, `FKOJUNST_Status`, `部品納期個数`,
`FHINMEI_MH_SH`, `FKOBAINO`, and `slingsInspectionRecord_PowerApps`.

Local validation evidence as of 2026-07-25 10:37Z:

    focused reservation/runtime tests: 4 files, 42 tests passed
    focused route integration: 2 files, 9 tests passed
    full API: 463 files passed, 2 skipped; 2,435 tests passed, 7 skipped
    full Web: 302 files passed; 1,500 tests passed
    API lint/build: passed
    Web lint/build: passed
    deploy contracts: passed, including 841 release-safety tests
    temporary PostgreSQL: 153 migrations current; rollback confirmed; index path confirmed
    temporary Docker resources: exact container, volume, and network names absent after each completed run

## Interfaces and Dependencies

The reserved-subject module exports the canonical constant, normalization and collision
functions, and a typed domain error. The error is translated at the existing HTTP boundary
to status 400 and code `GMAIL_SUBJECT_PATTERN_RESERVED`.

The Gmail serializer boundary has one method:

    interface GmailRequestSerializer {
      runExclusive<T>(operation: string, task: () => Promise<T>): Promise<T>;
    }

The default adapter is a process-wide FIFO queue. No library or schema dependency is added.
A future horizontally scaled API may replace this adapter with a distributed implementation
without changing Gmail clients.

The assembly service depends only on:

    interface CsvImportActivityReader {
      isCsvImportRunning(): boolean;
    }

The current adapter reads the singleton `CsvImportScheduler`; tests use a stub. Busy errors
translate to status 409 and code `ASSEMBLY_PROCEDURE_GMAIL_CSV_BUSY`.

Revision note (2026-07-25 10:02Z): Initial executable plan created after confirming the clean
base branch and re-reading the current implementation and repository rules.

Revision note (2026-07-25 10:37Z): Recorded completed implementation, partial-update
fail-closed hardening, route-level public-interface verification, and local validation
evidence before PR publication.

Revision note (2026-07-25 10:41Z): Recorded final full-suite counts and confirmed cleanup
of the final isolated PostgreSQL container, volume, and network.
