# SOLID Refactor Phase 2 ExecPlan: Web hooks split and self-inspection service decomposition

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: solid-refactor-phase2-execplan-202607
- status: completed (uncommitted; commit/deploy await explicit user request per `.cursor/rules/20-git-workflow.mdc`)
- scope: apps/web/src/api/hooks.ts domain split; apps/api self-inspection.service.ts decomposition
- date: 2026-07-04
- source_of_truth: this file
- related_docs: docs/plans/solid-refactor-execplan-202607.md (phase 1, completed and deployed)

## Purpose / Big Picture

Phase 1 (`docs/plans/solid-refactor-execplan-202607.md`) split the web API client and two god route files using facade-preserving mechanical decomposition, and is deployed to production (commit `893c7799`). This phase continues with the two largest remaining god modules identified by the phase-1 audit:

- `apps/web/src/api/hooks.ts` (2,946 lines, ~100 TanStack Query hooks) — split by domain, mirroring the existing `apps/web/src/api/domains/` axis, keeping `hooks.ts` as a re-export facade so no import site changes.
- `apps/api/src/services/part-measurement/self-inspection.service.ts` (4,386 lines) — decompose into cohesive sub-services behind the existing public class kept as a facade, so routes and tests don't change.

Both steps are strictly behavior-preserving. Success is observable by identical test results before and after each step.

## Progress

- [x] (2026-07-04 09:25+09:00) Working tree confirmed clean on `main` at `89a8e132` (phase-1 refactor merged and deployed).
- [x] (2026-07-04 09:29+09:00) Baseline verification green: API (`bash scripts/test/run-tests.sh`, container `postgres-test-local`) = Test Files 412 passed | 2 skipped (414), Tests 2098 passed | 9 skipped (2107). Web (`pnpm --filter @raspi-system/web test`) = Test Files 244 passed, Tests 1179 passed. Identical to phase-1 baseline.
- [x] (2026-07-04 09:27+09:00) Read-only structure exploration of both target files done (two explore subagents). Key findings summarized in `Context and Orientation`.
- [x] (2026-07-04 09:57+09:00) Step W3 done: `hooks.ts` is a 15-line facade over 12 domain modules in `apps/web/src/api/hooks/` (tools, kiosk, part-measurement, production-schedule, measuring-instruments, clients, system, signage, kiosk-documents, csv-visualization, rigging, backup). Export count identical (188). Verified: `tsc -b` clean, eslint clean on touched files, full web suite 244 files / 1,179 tests passed (= baseline).
- [x] (2026-07-04 10:26+09:00) Step A3 done (worker subagent, relaunched after the first attempt died on a transient network error): `self-inspection.service.ts` reduced from 4,386 to 1,685 lines (facade: `SelfInspectionService` class with all 19 public methods in original order/signatures, `LIST_SESSIONS_MAX`, and all module-level re-exports). 7 sub-modules under `apps/api/src/services/part-measurement/self-inspection/`: `shared.ts` (339), `serialization.ts` (873), `decoration.ts` (373), `mutation-guards.ts` (251), `entry-registration.ts` (354), `inspector-entry.ts` (193), `instrument-pre-use-inspection.ts` (590). Verbatim line moves only (mechanical `private`→`export function`, `this.` removal, `loanEventService` passed as argument to the two loan-bridge functions); normalized-sort diff confirmed zero implementation lines lost. All 9 `resetSelfInspectionMachineBoardScheduleRowCaches()` call sites preserved.
- [x] (2026-07-04 10:28+09:00) Final verification: API full suite (worker, `bash scripts/test/run-tests.sh`) = 412 files passed | 2 skipped, 2,098 tests passed | 9 skipped — baseline match. Web full suite = 244 files / 1,179 tests passed — baseline match. Orchestrator spot-re-ran the 3 self-inspection unit test files (14 tests green). `tsc` (api `tsconfig.build.json`, web `tsc -b`) and eslint clean on all touched files. Test Postgres container `postgres-test-local` stopped and removed; no leftover volumes. docs/INDEX.md link added.

Open items carried from phase 1 (not in this phase's scope):

- Remove remaining direct `lib/prisma` imports from route files (~51 files match today).
- Split `production-schedule-query.service.ts` (2,051 lines); extract shared loan orchestration; partition `config/env.ts` (554 lines).
- Decompose admin god pages (`SignageSchedulesPage.tsx` 1,618, `CsvImportSchedulePage.tsx` 1,568, `CsvDashboardsPage.tsx` 916, `VisualizationDashboardsPage.tsx` 700).

## Surprises & Discoveries

- (2026-07-04) Both step workers were killed mid-task by a transient DNS failure (`getaddrinfo ENOTFOUND`). The W3 worker had already finished writing all files; the orchestrator completed verification and lint cleanup directly (the worker had left ~3,000 unused import specifiers because each domain module was seeded with the full monolith import block; removed with a one-off script, then `eslint --fix` for import order).
- (2026-07-04) The first A3 worker only left a throwaway codegen script (`generate-modules.mjs`) and had not touched the service file; the relaunched worker was instructed to delete it and do verbatim manual moves instead.

## Decision Log

- Decision: Scope phase 2 to Steps W3 (hooks split) and A3 (self-inspection decomposition) only.
  Rationale: These are the two largest remaining god modules; both have the proven facade-preserving recipe from phase 1. Remaining items stay as open items for later phases to keep diffs reviewable.
  Date/Author: 2026-07-04 / Fable 5 (orchestrator)
- Decision: Reuse the repo-standard disposable test container flow (`scripts/test/run-tests.sh`, container `postgres-test-local`) and remove it after verification.
  Rationale: Same as phase 1; no production/dev database is touched.
  Date/Author: 2026-07-04 / Fable 5

## Outcomes & Retrospective

Both target god modules were decomposed with zero behavior change and zero import-site churn, verified against the recorded baseline:

- `apps/web/src/api/hooks.ts`: 2,946 → 15 lines (facade re-exporting 12 domain modules in `apps/web/src/api/hooks/`, largest `production-schedule.ts` 1,575 lines). Export surface identical (188 exported symbols). All 80 importing files (incl. 8 `vi.mock` sites) unchanged.
- `apps/api/src/services/part-measurement/self-inspection.service.ts`: 4,386 → 1,685 lines (class facade + 7 sub-modules, 2,973 lines moved). Public API (19 methods + ~15 module-level exports) unchanged; all consuming services and mocks untouched.

Acceptance met: API suite 412 files / 2,098 tests and web suite 244 files / 1,179 tests, both identical to baseline; typecheck and lint clean.

Retrospective notes:

- The facade-preserving recipe from phase 1 again required no import-site changes, keeping both diffs mechanically reviewable.
- Worker subagents can die mid-task on transient network failures; recovery cost was low because each step's output is verifiable from the working tree (W3 turned out finished and only needed lint cleanup; A3 had only a throwaway script to discard before relaunch). Verify leftover state before assuming a failed worker did nothing.
- Seeding split modules with the full monolith import block produces thousands of unused-import warnings; workers should trim imports per module, or the orchestrator needs a cleanup pass (here: one-off script + `eslint --fix`).

Changes are uncommitted, as in phase 1. Remaining hotspots are recorded under Progress open items for a future phase (production-schedule-query.service, env.ts, admin god pages, residual direct `lib/prisma` route imports).

## Context and Orientation

See phase 1 plan for monorepo layout and the facade pattern definition. Key phase-1 outcomes this phase builds on:

- `apps/web/src/api/client.ts` is a 46-line facade over `http.ts` + 15 domain modules in `apps/web/src/api/domains/`.
- `apps/api/src/routes/part-measurement/index.ts` is a composition root over 7 sub-registrars + `shared.ts`.

Structure-exploration findings (2026-07-04):

`apps/web/src/api/hooks.ts` (2,946 lines):

- 102 exports: 100 `use*` hooks + 2 types (`KioskProductionScheduleOrderCachePolicy`, `UpdateKioskProductionScheduleOrderVariables`). No raw function/const exports. No exported query-key factories (all inline string arrays).
- Domain grouping (aligned with `api/domains/*`): production-schedule ~74 hooks (largest), tools 20, part-measurement 19, backup 19 (maps to `api/backup.ts`, no `domains/` counterpart), measuring-instruments 16, signage 10, clients 7, kiosk 5, system 5, csv-visualization 4, rigging 4, kiosk-documents 3. No hooks for auth/assembly/mobile-placement.
- 80 files import from `api/hooks` (72 production + 8 test mocks); zero namespace imports, so a facade keeps every import and `vi.mock` path working.
- Cross-domain coupling is via query-key strings only (e.g. part-measurement mutations invalidate `['kiosk-production-schedule']`), except `useSignageScheduleEditorClients` which calls `useClients()` — a one-way signage→clients module import resolves it.
- No test file tests hooks.ts directly.

`apps/api/src/services/part-measurement/self-inspection.service.ts` (4,386 lines):

- Exports the `SelfInspectionService` class (19 public methods, no constructor args, single instance field `loanEventService`) plus ~15 module-level symbols (decoration cache helpers, `pickSessionForScheduleRow`, policy resolvers, types) that other services import directly from this path (`production-schedule-query.service.ts`, `self-inspection-machine-board.*`, `self-inspection-machine-target-selector.service.ts`).
- Method clusters: session lifecycle (resolveOrCreateSession/completeSession/resetSession), reads (listSessions/getSessionDetail/getInspectorMeasurementSessionDetail/listPendingOutOfToleranceReviews), record-approval (4 methods), operator entry commands (createEntry/updateEntry/approveOutOfToleranceReview), inspector entry commands (thin delegates over saveInspectorEntry), loan-bridge (2 pre-use-inspection methods ~500 lines each using `MeasuringInstrumentLoanEventService`), leaderboard decoration (buildLeaderboardDecorations + module-level cache helpers).
- ~24 private class methods + ~30 module-private helpers; measurement validation and serialization helpers are shared across clusters.
- No instance caches; prisma is the global singleton throughout (matches repo pattern).
- Test coverage: 3 direct unit test files plus the large `routes/__tests__/part-measurement.integration.test.ts`; several other services `vi.mock` this module path.

## Plan of Work

Step W3 (web, large but mechanical): split `apps/web/src/api/hooks.ts` into per-domain hook modules (directory to be fixed after exploration, expected `apps/web/src/api/hooks/`), aligned with the `api/domains/` axis. `hooks.ts` becomes a pure re-export facade; no import site outside `apps/web/src/api/` changes. Shared query-key factories/helpers move to a shared module.

Step A3 (api, large): decompose `self-inspection.service.ts` into cohesive sub-services (expected axes: session lifecycle / read-queries / write-commands / loan-bridge, to be fixed after exploration) under `apps/api/src/services/part-measurement/self-inspection/`. The existing exported class keeps its name, constructor signature, and full public method surface, delegating to the sub-services, so routes and tests don't change.

Each step is executed by a Composer 2.5 worker subagent; the orchestrator verifies against baseline before the next step.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

API verification: `bash scripts/test/run-tests.sh` (auto-manages Docker container `postgres-test-local`; when the container is already up on 5432, export `POSTGRES_PORT=5432` explicitly — see phase-1 discovery).

Web verification: `pnpm --filter @raspi-system/web exec tsc -b && pnpm --filter @raspi-system/web test`.

Cleanup after all verification: `pnpm test:postgres:stop` and remove the container's anonymous volume.

## Validation and Acceptance

Acceptance is behavioral equivalence: after each step the full relevant suite passes with the same counts as this phase's baseline, `tsc -b` is clean, and lint is clean. For Step A3, all part-measurement/self-inspection tests must pass unchanged. For Step W3, all web suites must pass unchanged with no import-site churn outside `apps/web/src/api/`.

## Idempotence and Recovery

Pure source refactorings; revert per file with `git checkout -- <path>` if a step's verification fails and forward-fix isn't obvious. The test Postgres container and volume are disposable.

## Artifacts and Notes

Baseline (2026-07-04, before any change):

    API (bash scripts/test/run-tests.sh):
      Test Files  412 passed | 2 skipped (414)
      Tests       2098 passed | 9 skipped (2107)
    Web (pnpm --filter @raspi-system/web test):
      Test Files  244 passed (244)
      Tests       1179 passed (1179)

These counts are the acceptance reference for every subsequent step.

Revision note (2026-07-04): initial version, written before step execution.
