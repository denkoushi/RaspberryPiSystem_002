# SOLID Refactor Phase 5 ExecPlan: client-device auth hub, Tier-1 prisma route cleanup, loan orchestration helpers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: solid-refactor-phase5-execplan-202607
- status: in progress
- scope: apps/api services/clients auth hub; ~19 Tier-1 route files losing direct lib/prisma imports; measuring/rigging loan shared transaction helpers with characterisation tests
- date: 2026-07-04
- source_of_truth: this file
- related_docs: docs/plans/solid-refactor-execplan-202607.md (phase 1, deployed `893c7799`), docs/plans/solid-refactor-phase2-execplan-202607.md (phase 2, deployed `fe2d4a42`), docs/plans/solid-refactor-phase3-execplan-202607.md (phase 3, deployed `72ff6550`), docs/plans/solid-refactor-phase4-execplan-202607.md (phase 4, deployed `3042f8cd`)

## Purpose / Big Picture

Phases 1–4 decomposed god files (web API client, god routes, `hooks.ts`, `self-inspection.service.ts`, `production-schedule-query.service.ts`, four admin pages, `config/env.ts`) behind facades; all deployed. Phase 5 tackles the two open items carried since phase 3/4, now scoped precisely by two read-only explorations (2026-07-04):

1. **Route-layer prisma imports (Steps C1 + R1a + R1b)**: 26 non-test route files import `lib/prisma` directly, with 42 direct call sites. ~35 of those are one duplicated pattern: `x-client-key → prisma.clientDevice.findUnique` auth (sometimes with JWT fallback). Create one shared `ClientDeviceAuthService` in `services/clients/` and adopt it across the Tier-1 files; move the remaining mechanical one-liners (backup history read, employee/department lists, delete preflight `loan.count`, metrics/health DB probes, leaderboard prisma injection) into existing/new small service functions. Result: 19 of 26 files become prisma-free; the 7 harder files (webrtc signaling, unified list, rigging tags, 4 kiosk moderate routes) are explicitly deferred.
2. **Loan orchestration (Step A6)**: `measuring-instruments/loan.service.ts` (209) and `rigging/loan.service.ts` (185) have structurally identical borrow/return transaction cores (create Loan + asset status IN_USE/AVAILABLE + audit Transaction), differing only in Prisma delegate / FK / snapshot key names. Extract shared transaction helpers with explicit per-call contracts (no vague bags), keeping both service classes as facades at their existing paths. `tools/loan.service.ts` (580) stays untouched — its polymorphic return/cancel, photoBorrow, delete, findActive are genuinely domain-specific. Because measuring/rigging currently have ZERO unit tests, characterisation tests (mocked prisma, mirroring `tools/__tests__/loan.service.test.ts` style) are added BEFORE the extraction.

All steps are behavior-preserving. Success is observable by identical test results before and after each step (plus exactly the new characterisation-test files for A6).

Out of scope (deferred with reasons): `webrtc/signaling.ts` (447-line WebSocket state machine; prisma is 3 reads but the file needs its own design pass), `tools/unified/list.ts` + `rigging/index.ts` tag CRUD (should follow once tag/loan shared design settles), `kiosk/config.ts` / `support.ts` / `signage-preview.ts` / `call-targets.ts` (Tier 2: need small new kiosk services, next phase), tools `LoanService` internals.

## Progress

- [x] (2026-07-04 21:36+09:00) Working tree confirmed clean on `main` at `18b8a35c` (phase 4 merged, deployed, verified PASS 45/0/0).
- [x] (2026-07-04 21:42+09:00) Baseline verification green: API (`bash scripts/test/run-tests.sh`, container `postgres-test-local` on 5432) = Test Files 412 passed | 2 skipped (414), Tests 2098 passed | 9 skipped (2107). Web = Test Files 249 passed, Tests 1245 passed. Matches phase-4 final state.
- [x] (2026-07-04 21:39+09:00) Read-only exploration of loan services (A–G report) and the 26 prisma-importing route files (A–F report with per-file tier assignment) completed by two explore subagents. Key findings recorded in `Context and Orientation`.
- [x] (2026-07-04 21:52+09:00) Step C1+R1a done (worker subagent): new `apps/api/src/services/clients/client-device-auth.service.ts` (91 lines; lookup functions `findClientDeviceByApiKey`/`findClientDeviceStatusClientIdByApiKey`/`findClientDeviceIdRecordByApiKey`/`findClientDeviceProfileById` + header helpers `parseKioskApiClientKeyHeader`/`assertKioskApiClientKeyValid`/`requireKioskClientDevice`/`resolveStatusClientIdFromRawKey`). 12 route files converted (incl. `webrtc/signaling.ts` — its 2 prisma lookups only; WS logic untouched); net −95 lines; all converted files prisma-free. Verified by worker: `tsc -p tsconfig.build.json --noEmit` clean, full API suite = baseline exactly (412/2,098), lint clean. Orchestrator verified: diffs are pure delegation (error codes/messages/selects byte-identical), remaining route prisma-importers = 14 (the R1b targets + 7 deferred).
- [x] (2026-07-04 21:59+09:00) Step R1b done (worker subagent): 7 more route files prisma-free. `BackupConfigHistoryService.listHistory/getHistoryEntryById` (backup/config-write.ts), `EmployeeService.listDistinctDepartments/listActiveForKiosk` (tools/departments.ts, kiosk/employees.ts), `LoanService.countActiveLoansForItem/ForEmployee` (tools delete preflights), `routes/system/metrics-db-aggregates-cache.ts` relocated to `services/system/` with prisma defaulted inside (signature `(prisma, ttlMs)` → `(ttlMs)`; sole caller updated), new `services/system/db-health.service.ts` `checkDatabaseConnection()` (health route; `health.test.ts`'s `vi.mock('lib/prisma')` still intercepts, test unchanged and green), `materializeProcessChangeResidualStrongEvidence` gained an options-only overload (existing `(prisma, options?)` callers unchanged). Verified by worker: `tsc -p tsconfig.build.json --noEmit` clean, full API suite = baseline exactly (412/2,098), lint clean. Orchestrator verified: all query moves verbatim (where/select/orderBy identical), route prisma-importers now exactly the 6 deferred files (kiosk/config.ts, kiosk/support.ts, kiosk/signage-preview.ts, kiosk/call-targets.ts, rigging/index.ts, tools/unified/list.ts).
- [x] (2026-07-04 22:06+09:00) Step A6 done (worker subagent): Stage 1 characterisation tests written FIRST against the unmodified services and verified green (`measuring-instruments/__tests__/loan.service.test.ts` 426 lines / 12 cases, `rigging/__tests__/loan.service.test.ts` 412 lines / 12 cases; mocked prisma/EmployeeService/logger/post-tx services, mirroring tools' test style). Stage 2: new `apps/api/src/services/loan/loan-transaction.helpers.ts` (77 lines; `findActiveLoanForAsset`, `executeAssetBorrowTransaction`, `executeAssetReturnTransaction` — explicit named params, delegate-specific callbacks for asset status updates); measuring loan.service 209→204 lines, rigging 185→180, facades/exports/log messages/error codes unchanged, post-tx side effects (NFC event / rigging inspection) stayed in facades. Stage-1 tests passed UNCHANGED after extraction. Verified by worker: tsc clean, full API suite 414 files / 2,122 tests (= baseline + exactly 2 files / 24 tests), lint clean. Orchestrator verified: diffs show byte-identical where/data/include objects and operation order inside transactions.
- [x] (2026-07-04 22:08+09:00) Final verification (orchestrator): web suite 249 files / 1,245 tests (= phase-4 final; web untouched), `git diff --check` clean. Test container `postgres-test-local` and its anonymous volume (created 2026-07-04T12:37:30Z this session) removed; pre-existing dangling volumes untouched.
- [ ] Commit, push, CI green, ExecPlan/docs updated.

## Surprises & Discoveries

- (2026-07-04) 42 direct prisma call sites in routes collapse to essentially ONE duplicated auth pattern (~35 sites) plus a handful of one-line queries. Zero transactions in any of the 26 files. The debt is far more uniform than the raw file count suggested.
- (2026-07-04) measuring/rigging loan services have zero unit tests and zero route-level integration tests for borrow/return; the only indirect coverage is via tools' polymorphic return/cancel paths. Characterisation tests are a precondition, not an option.

## Decision Log

- Decision: Scope phase 5 to C1+R1a (auth hub + adoption), R1b (Tier-1 one-liners), A6 (measuring/rigging loan helpers only); defer webrtc/unified-list/rigging-tags/4 kiosk moderate routes and all of tools `LoanService`.
  Rationale: Explorer tier analysis shows Tier-1 is mechanical with broad existing integration coverage; the deferred files each need real design decisions. For loans, tools' contract differs genuinely (polymorphic asset restore, clientId update, performedByUserId, full snapshots) — forcing it into a generic port now would be over-engineering.
  Date/Author: 2026-07-04 / Fable 5 (orchestrator)
- Decision: Execute the three steps SERIALLY (C1+R1a → R1b → A6), each verified with the full API suite before the next starts.
  Rationale: All three touch apps/api and share the single disposable Postgres DB; phase 4 observed a flaky failure when multiple vitest suites ran concurrently against one machine. The API suite itself enforces `fileParallelism: false` for the same reason.
  Date/Author: 2026-07-04 / Fable 5
- Decision: A6 follows the explorer's Option 2 (facades kept, extract only the truly-identical measuring/rigging transaction cores into `services/loan/` helpers with explicit named parameters), with post-tx side effects (NFC event, rigging inspection) staying in each facade. Characterisation tests are written and verified green against the CURRENT implementation before any extraction commit.
  Rationale: Minimal-diff, honors the repo boundary rule (explicit contracts, no `context`/`data` bags), avoids touching tools. Option 1 (generic orchestrator + adapter ports) is deferred until tools needs it.
  Date/Author: 2026-07-04 / Fable 5
- Decision: The new auth service lives in `apps/api/src/services/clients/` next to `client-device-resolution.service.ts`; route files keep their existing response shapes, error codes, and messages byte-identical.
  Rationale: `services/clients/` is the established cross-domain client-device home; auth behavior is contractually visible to kiosks and covered by many integration tests.
  Date/Author: 2026-07-04 / Fable 5
- Decision: Reuse the repo-standard disposable test container flow (`scripts/test/run-tests.sh`, container `postgres-test-local` on 5432) and remove it after final verification. No production/dev database is touched.
  Rationale: Same as phases 1–4.
  Date/Author: 2026-07-04 / Fable 5

## Outcomes & Retrospective

All three steps landed with zero behavior change, verified against the recorded baseline:

- Route layer: direct `lib/prisma` imports reduced from 26 to 6 non-test files (the deferred Tier-2/3 set). The duplicated x-client-key auth pattern (~35 call sites) now lives in one place, `services/clients/client-device-auth.service.ts`; seven more files had their one-liner queries moved into cohesive service methods (`BackupConfigHistoryService` read methods, `EmployeeService` list methods, `LoanService` active-loan counts, `services/system/` metrics/db-health modules, leaderboard materialization prisma default).
- Loan layer: measuring/rigging borrow/return transaction cores now share `services/loan/loan-transaction.helpers.ts` with explicit named-parameter contracts; both service facades, their exports, and post-tx side effects are unchanged. The previously untested services gained 24 characterisation tests that were green before AND after the extraction, unmodified.

Acceptance met: API suite 414 files / 2,122 tests = baseline 412/2,098 + exactly the 2 new test files / 24 new tests; web suite 249/1,245 identical to phase-4 final (web untouched); typecheck (`tsc -p tsconfig.build.json --noEmit`) and lint clean after every step; `git diff --check` clean. Disposable test container and its anonymous volume removed.

Retrospective notes:

- Writing characterisation tests BEFORE extracting shared code (A6 Stage 1 gate) made the extraction provably behavior-preserving for services that had zero coverage; the tests were required to pass unchanged after the refactor, which caught nothing this time but is the right acceptance shape for future extractions.
- Serializing the three workers (shared API test DB) avoided the flaky-parallel-run problem observed in phase 4.
- The route-debt exploration paid off: what looked like 26 scattered files was ~85% one duplicated auth pattern, so one small service removed most of the debt.

Remaining hotspots for a future phase: 6 deferred route files (`kiosk/config.ts`, `kiosk/support.ts`, `kiosk/signage-preview.ts`, `kiosk/call-targets.ts` → small kiosk services; `rigging/index.ts` → `RiggingGearTagService` modeled on measuring's tag service; `tools/unified/list.ts` → unified inventory list service), `webrtc/signaling.ts` route slimming (prisma already removed; WS state machine design pass pending), tools `LoanService` internals (580 lines; could adopt the loan helpers via a return-port design if it ever needs restructuring).

## Context and Orientation

The system is a pnpm monorepo: `apps/api` (Fastify 5 + Prisma 5 + Zod + vitest, suite runs serially against one disposable Postgres), `apps/web` (React 18 + Vite), `packages/`. "Facade" = original file path keeps exporting the same public symbols; implementations move to sub-modules; import sites and `vi.mock` paths do not change.

### Exploration findings: route prisma imports (2026-07-04)

- 26 non-test route files, 42 direct `prisma.*` call sites, ZERO `$transaction`. Writes only in `kiosk/config.ts` (`clientDevice.update` lastSeenAt), `kiosk/signage-preview.ts` (`clientDevice.update`), `kiosk/support.ts` (`clientLog.create`), `rigging/index.ts` (tag CRUD — deferred).
- Dominant duplicated pattern (~35 sites): resolve `x-client-key` header → `prisma.clientDevice.findUnique` (select varies: id / name / statusClientId / metadata), sometimes as JWT-or-client-key fallback (`allowClientKey` helpers in measuring-instruments/part-measurement/loan-analytics; `requireClientDevice` hub in `kiosk/shared.ts` L59–74; per-file copies in storage/* and `signage/render.ts`).
- Tier 1 (this phase, 19 files): `kiosk/shared.ts`, `system/health.ts` (`$queryRaw SELECT 1`; NOTE `routes/__tests__/health.test.ts` does `vi.mock('../../lib/prisma.js')` — the seam must survive), `system/metrics.ts` (prisma passed into `resolveMetricsDbAggregates` from `routes/system/metrics-db-aggregates-cache.ts` — move helper under `services/system/`), `system/deploy-status.ts`, `measuring-instruments/index.ts`, `part-measurement/index.ts`, `tools/items/loan-analytics.ts`, `tools/items/delete.ts` + `tools/employees/delete.ts` (preflight `loan.count`), `tools/departments.ts` (`employee.findMany` → distinct departments), `kiosk/employees.ts` (`employee.findMany` ACTIVE select), `storage/pdfs.ts`, `storage/photos.ts`, `storage/part-measurement-drawings.ts`, `storage/assembly-procedure-images.ts`, `storage/measuring-instrument-genres.ts`, `signage/render.ts`, `backup/config-write.ts` (history GET: `backupConfigChange.findMany/count/findUnique` → extend `services/backup/backup-config-history.service.ts` which today only writes), `kiosk/production-schedule/leaderboard-phased-read.ts` (only passes prisma into `materializeProcessChangeResidualStrongEvidence` — default it inside the service).
- Deferred: `webrtc/signaling.ts` (Tier 3), `tools/unified/list.ts`, `rigging/index.ts`, `kiosk/config.ts`, `kiosk/support.ts`, `kiosk/signage-preview.ts`, `kiosk/call-targets.ts` (Tier 2).
- Test landscape: broad real-DB integration coverage exists for kiosk (`routes/__tests__/kiosk.integration.test.ts`), measuring-instruments, part-measurement, photo-storage, part-measurement-drawings, items/employees delete preflight (`items.integration.test.ts` L233+, `employees.integration.test.ts` L255+), signage render, deploy-status, backup (but NOT `/backup/config/history`). `health.test.ts` is the only route test mocking `lib/prisma`.
- Exemplar delegation patterns already in the repo: `routes/auth.ts` (schema.parse → service call), `routes/kiosk/production-schedule/list.ts` (deps.requireClientDevice + named service function), `routes/imports/schedule.ts` (service class + preHandler), `routes/tools/loans/borrow.ts` (service injected by parent index).

### Exploration findings: loan services (2026-07-04)

- All three domains share the single `Loan` table; asset delegates differ (`prisma.item` / `prisma.measuringInstrument` / `prisma.riggingGear`) with parallel status enums (`AVAILABLE | IN_USE | MAINTENANCE | RETIRED`) and different FK fields on Loan (`itemId` / `measuringInstrumentId` / `riggingGearId`).
- measuring (`services/measuring-instruments/loan.service.ts`: borrow 51–150, return 152–208) vs rigging (`services/rigging/loan.service.ts`: borrow 51–140, return 142–184): tx cores structurally identical — active-loan findFirst (tx外), `tx.loan.create` + asset `update` to IN_USE + `tx.transaction.create` (BORROW, snapshot keys `instrumentSnapshot` vs `riggingSnapshot`); return = `loan.update` returnedAt + asset AVAILABLE + Transaction RETURN `{ note }`. Differences: post-tx side effects (measuring → `MeasuringInstrumentLoanEventService.recordNfcEvent`; rigging → `RiggingBorrowInspectionOrchestrator.recordIfNotDuplicate`), which stay in the facades.
- tools `LoanService` (580 lines) is contractually different (NFC-only resolve, clientId update on return, performedByUserId, full snapshots, polymorphic asset restore at 236–251/487–502, photoBorrow/cancel/delete/findActive) — untouched this phase.
- Callers: routes + barrel re-exports only; NO service-to-service imports; NO `vi.mock` of any loan.service path (facade freedom is high, but keep paths/symbols anyway).
- Tests today: tools has 29 mocked-prisma unit cases (`services/tools/__tests__/loan.service.test.ts`) + 8 integration; measuring/rigging have ZERO dedicated tests. A6 adds characterisation tests first (mocked prisma, same pattern as tools' test), verified green against the unmodified implementation, then the extraction lands with those tests still green.

## Plan of Work

Step C1+R1a (worker 1): create `apps/api/src/services/clients/client-device-auth.service.ts` exposing explicit named functions (e.g. `findClientDeviceByApiKey(apiKey, select?)` and a `requireClientDevice`-compatible helper; exact API shaped to cover the observed variants: required vs optional, select fields, JWT fallback caller-side). Adopt it in: `kiosk/shared.ts`, `measuring-instruments/index.ts`, `part-measurement/index.ts`, `tools/items/loan-analytics.ts`, `storage/pdfs.ts`, `storage/photos.ts`, `storage/part-measurement-drawings.ts`, `storage/assembly-procedure-images.ts`, `storage/measuring-instrument-genres.ts`, `signage/render.ts`, `system/deploy-status.ts`, `webrtc/signaling.ts` の3 lookup（※prisma-free化のみ、WS本体は不変更 — worker may skip if risky and report). Every route keeps byte-identical status codes, error payloads, and select shapes. Remove the `lib/prisma` import from each converted file.

Step R1b (worker 2): mechanical one-liner moves — `BackupConfigHistoryService.listHistory/getById` (new read methods) for `backup/config-write.ts`; `EmployeeService.listDistinctDepartments` + kiosk active-employee list for `tools/departments.ts` / `kiosk/employees.ts`; delete-preflight active-loan count into an appropriate tools service for `tools/items/delete.ts` / `tools/employees/delete.ts`; relocate `routes/system/metrics-db-aggregates-cache.ts` under `services/system/` with prisma defaulted inside for `system/metrics.ts`; DB probe helper for `system/health.ts` (must keep `vi.mock('lib/prisma')` in `health.test.ts` working — keep the service importing `lib/prisma` so the mock still intercepts); default the prisma argument inside `materializeProcessChangeResidualStrongEvidence` for `leaderboard-phased-read.ts`.

Step A6 (worker 3): first add characterisation tests `services/measuring-instruments/__tests__/loan.service.test.ts` and `services/rigging/__tests__/loan.service.test.ts` (mocked prisma; borrow happy path incl. tag+id resolution, duplicate-active-loan rejection, employee-not-found, return happy path, post-tx side-effect invocation) and verify green against the current code. Then create `apps/api/src/services/loan/loan-transaction.helpers.ts` with explicit named-parameter helpers (`findActiveLoanForAsset`, `executeAssetBorrowTransaction`, `executeAssetReturnTransaction`) and rewrite the measuring/rigging tx cores to call them; facades, exported symbols, post-tx side effects, and log messages unchanged.

Each step is executed by a Composer 2.5 worker subagent, serially; the orchestrator verifies against baseline before the next step starts.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

API verification: `POSTGRES_PORT=5432 bash scripts/test/run-tests.sh` (container `postgres-test-local` already running on 5432; the explicit port export is required because the script auto-switches to 55432 when 5432 is occupied). Typecheck: `pnpm --filter @raspi-system/api exec tsc -p apps/api/tsconfig.build.json --noEmit` 相当（run from apps/api: `tsc -p tsconfig.build.json --noEmit`; plain `tsc --noEmit` has a known pre-existing TS6059 failure, see phase 4).

Web verification (final only; web untouched this phase): `pnpm --filter @raspi-system/web test`.

Cleanup after all verification: stop and remove `postgres-test-local` and its anonymous volume created this session.

## Validation and Acceptance

Acceptance is behavioral equivalence: after each step the full API suite passes with baseline counts (412 files | 2 skipped, 2098 tests | 9 skipped) plus, for A6 only, exactly the two new characterisation-test files; typecheck and lint clean. Auth-touching routes are additionally guarded by the existing kiosk/measuring/part-measurement/storage/signage integration tests, which must pass unchanged. `routes/__tests__/health.test.ts` (prisma mock) must pass unchanged. After C1+R1a+R1b, `rg -l "from ['\"].*lib/prisma" apps/api/src/routes | rg -v __tests__` must list only the 7 deferred files.

## Idempotence and Recovery

Pure source refactorings; revert per file with `git checkout -- <path>` (and `rm -rf` of new directories) if a step's verification fails and forward-fix isn't obvious. The test Postgres container and volume are disposable.

## Artifacts and Notes

Baseline (2026-07-04 21:42+09:00, before any change; equals phase-4 final state):

    API (bash scripts/test/run-tests.sh):
      Test Files  412 passed | 2 skipped (414)
      Tests       2098 passed | 9 skipped (2107)
    Web (pnpm --filter @raspi-system/web test):
      Test Files  249 passed (249)
      Tests       1245 passed (1245)

These counts are the acceptance reference for every subsequent step.

Revision note (2026-07-04): initial version, written before step execution.
