# SOLID Refactor Phase 3 ExecPlan: production-schedule query decomposition and admin god page split

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: solid-refactor-phase3-execplan-202607
- status: completed; committed, pushed, CI green, deployed to Pi5 + Pi4x5 + Pi3, Phase12 verified
- scope: apps/api production-schedule-query.service.ts decomposition; apps/web SignageSchedulesPage.tsx and CsvImportSchedulePage.tsx feature split
- date: 2026-07-04
- source_of_truth: this file
- related_docs: docs/plans/solid-refactor-execplan-202607.md (phase 1, deployed `893c7799`), docs/plans/solid-refactor-phase2-execplan-202607.md (phase 2, deployed `fe2d4a42`)

## Purpose / Big Picture

Phases 1 and 2 split the web API client, two god route files, `apps/web/src/api/hooks.ts`, and `self-inspection.service.ts` using a facade-preserving mechanical decomposition; both phases are deployed to production. This phase continues down the phase-1 audit's open-item list with the next largest hotspots:

- `apps/api/src/services/production-schedule/production-schedule-query.service.ts` (2,052 lines, 16 exported functions + 16 exported types + 1 re-export, no class) — split into cohesive sub-modules under `production-schedule-query/`, keeping the original path as a re-export facade so all 32 importing files (including `vi.mock`/`vi.spyOn` sites) keep working.
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx` (1,618 lines) and `apps/web/src/pages/admin/CsvImportSchedulePage.tsx` (1,568 lines) — decompose into `features/admin/signage/` and `features/admin/csv-import/` (pure helpers + presentational components + feature hooks), leaving each page as a thin composition, following the existing `features/admin/loan-report/` and `dgx-resource/` patterns.

All steps are strictly behavior-preserving. Success is observable by identical test results before and after each step. The admin pages have no direct tests today, so the web steps additionally add round-trip unit tests for the extracted pure model layers (signage layout config build/parse; csv-import cron form conversion) as a safety net — a test-only addition, no production behavior change.

## Progress

- [x] (2026-07-04 15:16+09:00) Working tree confirmed clean on `main` at `fe2d4a42` (phase 2 merged and deployed).
- [x] (2026-07-04 15:21+09:00) Baseline verification green: API (`bash scripts/test/run-tests.sh`, container `postgres-test-local`) = Test Files 412 passed | 2 skipped (414), Tests 2098 passed | 9 skipped (2107). Web (`pnpm --filter @raspi-system/web test`) = Test Files 244 passed, Tests 1179 passed. Identical to phase-1/2 baseline.
- [x] (2026-07-04 15:21+09:00) Read-only structure exploration of all three target files done (two explore subagents). Key findings summarized in `Context and Orientation`.
- [x] (2026-07-04 15:30+09:00) Step A4 done (worker subagent): `production-schedule-query.service.ts` reduced from 2,052 to 78 lines (pure re-export facade). 12 sub-modules under `apps/api/src/services/production-schedule/production-schedule-query/`: `types.ts` (96), `filters.ts` (324), `raw-page.ts` (109), `leaderboard-shell.ts` (496), `leaderboard-decoration.ts` (205), `self-inspection-eligible.ts` (186), `signage-machine-board.ts` (138), `signage-auto-target.ts` (203), `list.ts` (186), `order-search.ts` (117), `resources.ts` (49), `order-usage.ts` (63). Plain `export { ... } from` re-exports satisfied all `vi.spyOn` tests (no fallback needed). Deviations: `ProductionScheduleListResult` placed in `types.ts` to break a list↔leaderboard-shell cycle; formerly-file-private helpers exported from sub-modules for sibling imports (facade surface unchanged). Verified by worker: tsc clean, targeted 25 files / 211 tests, full API suite 412 files / 2,098 tests (= baseline), eslint clean. Orchestrator verified: export-surface diff vs `git show HEAD:` empty (33 symbols identical); spot re-ran the spy/mock-sensitive tests (3 files / 16 tests green).
- [x] (2026-07-04 15:28+09:00) Step W4a done (worker subagent): `SignageSchedulesPage.tsx` reduced from 1,618 to 41 lines (thin composition). 8 new files under `apps/web/src/features/admin/signage/`: `signageScheduleDisplay.ts` (76), `signageLayoutConfigModel.ts` (640, pure build/parse conversion), `signageLayoutConfigModel.test.ts` (407, NEW: 22 round-trip/validation tests covering all 8 FULL slot kinds, SPLIT, legacy forms), `VisualizationDashboardGroupedSelect.tsx` (92), `useSignageScheduleEditor.ts` (481), `SignageScheduleEditorForm.tsx` (742), `SignageScheduleListTable.tsx` (93), `SignageScheduleToolbar.tsx` (39). Deviations: conversion logic extracted as pure patch-returning functions (state application stays in the hook); `(isCreating || editingId)` conditional moved into component early-returns (render result identical). Verified: `tsc -b` clean, lint 0 errors, web suite 245 files / 1,201 tests (= baseline 244/1,179 + exactly the 1 new file / 22 new tests).
- [x] (2026-07-04 15:33+09:00) Step W4b done (worker subagent): `CsvImportSchedulePage.tsx` reduced from 1,568 to 56 lines (thin composition). 13 new files under `apps/web/src/features/admin/csv-import/`: `csvImportScheduleUtils.ts` (337, moved from pages/admin with its 14-case test; old paths deleted, no external importers so no re-export shim needed), `csvImportError.ts` (16) + test (4 cases, NEW), `useCsvImportScheduleForm.ts` (347), `useCsvImportScheduleRun.ts` (132) + double-run-guard test (1 case, NEW), `CsvImportScheduleWarningsBanner.tsx` (23), `CsvImportScheduleTimingFields.tsx` (221), `CsvImportTargetsEditor.tsx` (162), `CsvImportScheduleCreateForm.tsx` (201), `CsvImportScheduleListSection.tsx` (238), `CsvImportSubjectPatternSection.tsx` (252). The create/edit JSX pairs were NOT identical (button labels, presets/help text, `scheduleEditable` handling, offset field position; differing dashboard auto-ID logic), so each pair became one component with a `variant`/`compact` prop preserving both behaviors. Verified: `tsc -b` clean, lint 0 errors, web suite 247 files / 1,206 tests (= 245/1,201 + exactly 2 new files / 5 new tests).
- [x] (2026-07-04 15:40+09:00) Final verification: orchestrator re-ran web suite (247 files / 1,206 tests = baseline 244/1,179 + this phase's 3 new test files / 27 new tests), web `tsc -b` and lint clean, and full API suite (`POSTGRES_PORT=5432 bash scripts/test/run-tests.sh`) = 412 files passed | 2 skipped, 2,098 tests passed | 9 skipped — baseline match. `git status` footprint is exactly the three refactor scopes + this plan file. Test container `postgres-test-local` and its anonymous volume removed (pre-existing dangling volumes untouched). docs/INDEX.md link added.
- [x] (2026-07-04 15:51+09:00) Committed and pushed to `origin/main`: `72ff6550ca453cd4a2b130c04fb3b6d2df8e88a6` (`refactor: split production schedule query and admin pages`). Pre-push verification also included `git diff --check`, web `tsc -b`/lint/test, API build/lint, and full API DB suite. The final local full API run passed 412 files | 2 skipped and 2,100 tests | 7 skipped; skip distribution differed from the earlier baseline run, but there were no failures.
- [x] (2026-07-04 16:11+09:00) GitHub Actions green for `72ff6550`: Secret scan `28698292124` success, CodeQL `28698292122` success, main CI `28698292125` success (`lint-build-unit`, `api-db-and-infra`, `security-docker`, `e2e-smoke`, `e2e-tests` all success), Pages `28698291788` success after rerunning a transient GitHub Pages deploy failure (`Deployment failed, try again later`).
- [x] (2026-07-04 16:44+09:00) Production deploy completed with the standard all-client command: `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach --follow` using `RASPI_SERVER_HOST=denkon5sd02@100.106.158.2`. Run ID `20260704-161204-25937`; summary success `true`; exit code 0; PLAY RECAP all 7 hosts had `failed=0` and `unreachable=0` (`raspberrypi5`, `raspberrypi4`, `raspi4-robodrill01`, `raspi4-fjv60-80`, `raspi4-kensaku-stonebase01`, `raspi4-sessaku-01`, `raspberrypi3`).
- [x] (2026-07-04 16:46+09:00) Real-machine verification passed: `./scripts/deploy/verify-phase12-real.sh` = PASS 45 / WARN 0 / FAIL 0. Covered API health, deploy-status for all Pi4 clients, production-schedule and due-management APIs, Pi5 migration/fallback/auto-tuning checks, all Pi4 kiosk/status-agent services, Pi3 signage-lite/timer, and `verify-services-real.sh`.

Open items carried from phases 1–2 (not in this phase's scope):

- Remove remaining direct `lib/prisma` imports from route files (~50 files match today).
- Extract shared loan orchestration from tools/rigging/measuring-instruments loan services; partition `apps/api/src/config/env.ts` (554 lines).
- Decompose remaining admin god pages (`CsvDashboardsPage.tsx` 916, `VisualizationDashboardsPage.tsx` 700).

## Surprises & Discoveries

- (2026-07-04) Plain `export { ... } from` re-exports in the A4 facade were sufficient for all `vi.spyOn`-based tests (3 files); the anticipated fallback (explicit `export const x = impl` bindings) was never needed. Vitest's module transformation keeps re-exported bindings spy-able.
- (2026-07-04) The create/edit JSX "duplicates" in CsvImportSchedulePage were NOT byte-identical: button labels, interval presets/help text, `scheduleEditable` gating, offset-field position, and dashboard auto-ID fallback logic all differ subtly between the two copies. Unifying them required explicit `variant`/`compact` props; a naive DRY merge would have silently changed behavior.
- (2026-07-04) The `signageLayoutConfigModel` round-trip tests (22 cases) passed on first run against the verbatim-moved conversion logic, confirming the parse/build pair was internally consistent in the original monolith.
- (2026-07-04) GitHub Pages had a source-unrelated transient deploy failure on the first run, then succeeded by rerunning the failed job. CodeQL, Secret scan, and main CI were unaffected.
- (2026-07-04) During Pi3 deploy, `signage-lite.service` can briefly show `activating (auto-restart)` with exit code while `lightdm` is stopped for memory savings. The play restores `lightdm`, starts the signage timers/services, waits for `signage-lite.service` to become active, and reports the final active state before success.

## Decision Log

- Decision: Scope phase 3 to Steps A4 (production-schedule query split) and W4a/W4b (two largest admin god pages).
  Rationale: Next largest hotspots from the audit; the facade recipe is proven for A4, and the web pages have clear existing `features/admin/` precedents. `CsvDashboardsPage`/`VisualizationDashboardsPage` and env.ts stay as open items to keep diffs reviewable.
  Date/Author: 2026-07-04 / Fable 5 (orchestrator)
- Decision: For W4a/W4b, allow adding new unit tests for extracted pure model functions (signage layout round-trip, csv cron conversion) even though the refactor is otherwise behavior-preserving.
  Rationale: Neither page has any direct test; a pure-function test is the cheapest way to prove the risky bidirectional conversions were moved intact. Test-only additions cannot change production behavior.
  Date/Author: 2026-07-04 / Fable 5
- Decision: Run A4 and W4a in parallel (separate workspaces, like phases 1–2), then W4b after W4a verifies.
  Rationale: api/web are independent; the two web steps touch overlapping conventions (`features/admin/`) and share the web test suite, so serializing them keeps verification unambiguous.
  Date/Author: 2026-07-04 / Fable 5
- Decision: Reuse the repo-standard disposable test container flow (`scripts/test/run-tests.sh`, container `postgres-test-local`) and remove it after final verification. No production/dev database is touched.
  Rationale: Same as phases 1–2.
  Date/Author: 2026-07-04 / Fable 5

## Outcomes & Retrospective

All three target god modules were decomposed with zero behavior change, verified against the recorded baseline:

- `apps/api/src/services/production-schedule/production-schedule-query.service.ts`: 2,052 → 78 lines (pure re-export facade over 12 sub-modules, largest `leaderboard-shell.ts` 496 lines). Export surface identical (33 symbols, diff vs HEAD empty); all `vi.spyOn`/`vi.mock` consumers pass unchanged.
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx`: 1,618 → 41 lines (thin composition over 8 files in `features/admin/signage/`; the risky bidirectional layout conversion now lives in pure `signageLayoutConfigModel.ts` guarded by 22 new round-trip/validation tests).
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`: 1,568 → 56 lines (thin composition over 13 files in `features/admin/csv-import/`; cron utils + test moved in from pages/admin; 5 new tests for error formatting and the double-run guard).

Acceptance met: API suite 412 files / 2,098 tests identical to baseline during implementation, and the final pre-push DB run also passed all files with 2,100 passed / 7 skipped tests due skip distribution; web suite 247 files / 1,206 tests = baseline + exactly the 3 new test files / 27 new tests; typecheck and lint clean on both workspaces. GitHub main CI, CodeQL, Secret scan, and Pages were green after push.

Operational acceptance:

- Commit: `72ff6550ca453cd4a2b130c04fb3b6d2df8e88a6` on `main`, pushed to `origin/main`.
- CI: main CI `28698292125` success; Secret scan `28698292124` success; CodeQL `28698292122` success; Pages `28698291788` success after a transient rerun.
- Deploy: all-client deploy run `20260704-161204-25937`, summary success true, exit code 0, PLAY RECAP all 7 hosts `failed=0 / unreachable=0`.
- Real-machine verification: `./scripts/deploy/verify-phase12-real.sh` PASS 45 / WARN 0 / FAIL 0.

Retrospective notes:

- Extracting risky stateful conversions as pure patch-returning functions (signage editor) made them unit-testable without changing the hook's `useState` structure — a good template for the remaining admin pages.
- "Duplicate" JSX blocks in god pages should be diffed carefully before unifying; both W4b pairs looked identical in the survey but carried real behavioral differences.
- This was the first phase where workers added tests during a behavior-preserving refactor (allowed by an explicit Decision Log entry); the +27 tests are pure additions and the counts were reconciled explicitly against baseline.

Remaining hotspots for a future phase: residual direct `lib/prisma` route imports (~50 files), shared loan orchestration extraction, `config/env.ts` partition, `CsvDashboardsPage.tsx` (916) and `VisualizationDashboardsPage.tsx` (700).

## Context and Orientation

The system is a pnpm monorepo: `apps/api` (Fastify 5 + Prisma 5 + Zod + vitest), `apps/web` (React 18 + Vite + TanStack Query v5 + vitest), `packages/` (shared pure logic). "Facade" here means: the original file path keeps exporting the exact same public symbols, but the implementations live in new sub-modules; import sites and `vi.mock` paths do not change.

Structure-exploration findings (2026-07-04):

`apps/api/src/services/production-schedule/production-schedule-query.service.ts` (2,052 lines):

- Exports: no class. 16 functions (`prepareProductionScheduleDashboardFilters`, `listLeaderboardShellProductionScheduleRows`, `listLeaderboardShellContinuationProductionScheduleRows`, `countProductionScheduleDashboardVisibleRowsFromListFilters`, `decorateLeaderboardShellRowsForKioskFromHydratedRows`, `decorateLeaderboardShellRowsForKiosk`, `listSelfInspectionEligibleProductionScheduleRows`, `scanProductionScheduleRowsForSignageMachineBoard`, `scanProductionScheduleRowsForSignageAutoTargetSelector`, `decorateRowsForSelfInspectionMachineTargetSelector`, `listProductionScheduleRowsForSignageMachineBoard`, `listProductionScheduleRows`, `searchProductionScheduleOrders`, `listProductionScheduleResources`, `getProductionScheduleOrderUsage`), 16 types, and 1 re-export (`normalizeMachineNameForCompare` from `./machine-name-compare.js`).
- Natural clusters: filters/SQL-builders (buildTextConditions, buildResourceConditions, buildResourceCategoryCondition, buildQueryWhere, buildProductNoCondition, buildMachineNameCondition, listMatchingFseibansByMachineName); raw page fetch (`fetchProductionScheduleDashboardRowsRawPage`, used by 4 clusters); leaderboard shell phased read; leaderboard kiosk decoration (`enrichLeaderboardListRowsAndFooter` shared with the list orchestrator); self-inspection eligible scan (`enrichProductionScheduleRowsForSelfInspectionCandidate` shared with auto-target); signage machine board scan; signage auto-target-selector scan; main list orchestrator (`listProductionScheduleRows`); order search; resources; order usage.
- Module-level state: three immutable numeric constants only; no mutable caches, no side-effectful module init.
- Import surface: 28 files import named symbols via the facade path, 9 type-only, 3 tests use `import * as` + `vi.spyOn` (`kiosk-production-schedule.integration.test.ts`, `resolve-leaderboard-board-resource-totals-for-continue.test.ts`, `leaderboard-composite-board-generation-token.test.ts`), 4 tests `vi.mock` the facade path. The facade must therefore re-export every function and type, and the spied functions must remain spy-able through the facade namespace.
- Cross-imports: this module imports from `self-inspection.service.ts` (decoration cache helpers) and `self-inspection-schedule-eligibility.ts`; `self-inspection-machine-board.*` and `self-inspection-machine-target-selector.service.ts` import scan/decorate functions back from this facade. No direct cycle (`self-inspection.service.ts` itself does not import this module), but new sub-modules must not import the machine-board services.
- Direct tests: `__tests__/production-schedule-query.service.test.ts` and `__tests__/list-self-inspection-eligible-scan.test.ts`.

`apps/web/src/pages/admin/SignageSchedulesPage.tsx` (1,618 lines):

- Single exported page component + 2 internal presentational components (`VisualizationDashboardGroupedSelect`, `VisualizationDashboardSelectHelp`) + pure helpers (`parseResourceCdListInput`, `formatVisualizationOptionLabel`, `groupVisualizationDashboardsForSignage`) + constants (`DAYS_OF_WEEK`, `DEFAULT_SCHEDULE_FORM_DATA`, `PALLET_VIZ_DATA_SOURCE`).
- The core is a 40+ `useState` layout editor with a risky bidirectional conversion: `handleEdit` (schedule → editor state, lines ~288–485) and `buildLayoutConfig` (editor state → `SignageLayoutConfig`, ~487–764) covering 8 FULL slot kinds + SPLIT + legacy contentType/pdfId compatibility. `buildLayoutConfig` also reads `pdfsQuery.data`.
- Already-extracted shared pieces exist in `components/signage/` (`SignagePdfManager`, `SignageTargetClientsField`). No Context/refs/DnD. No direct tests; router: static import in `App.tsx` (`/admin/signage/schedules`).
- Target: `features/admin/signage/` with pure display helpers, `signageLayoutConfigModel.ts` (build + parse with round-trip test), `useSignageScheduleEditor.ts`, `SignageScheduleEditorForm.tsx`, `SignageScheduleListTable.tsx`, `SignageScheduleToolbar.tsx`, `VisualizationDashboardGroupedSelect.tsx`; page becomes a thin composition.

`apps/web/src/pages/admin/CsvImportSchedulePage.tsx` (1,568 lines):

- Single monolithic component, zero internal sub-components. Sections: header actions, warnings banner, create form (~593–981), list table with inline edit rows (~983–1373), Gmail subject-pattern management (~1375–1565).
- Create form and inline edit share the same `formData` + cron UI state (`scheduleTime`, `scheduleDaysOfWeek`, `scheduleMode`, `intervalMinutes`, `offsetMinutes`, `scheduleEditable`, `scheduleEditWarning`), with exclusivity between `editingId` and `showCreateForm`. Manual-run uses `runningScheduleId` state + `runningScheduleIdRef` (must stay atomic if extracted). Timing fields and targets editor JSX are duplicated between create (~663–893) and edit (~1029–1229) — near-identical, candidates for one shared component each.
- Cron helpers already live outside the page in `pages/admin/csv-import-schedule-utils.ts` with a good test (`__tests__/csv-import-schedule-utils.test.ts`); both move to the feature directory (keeping a re-export or updating the few import sites, whichever is smaller).
- Not a route: rendered by `CsvImportPage.tsx` when `acquisition === 'scheduled'`. No direct tests, no vi.mock.
- Target: `features/admin/csv-import/` with `CsvImportScheduleTimingFields.tsx`, `CsvImportTargetsEditor.tsx`, `CsvImportScheduleWarningsBanner.tsx`, `CsvImportSubjectPatternSection.tsx`, `CsvImportScheduleCreateForm.tsx`, `CsvImportScheduleListSection.tsx`, `useCsvImportScheduleForm.ts`, `useCsvImportScheduleRun.ts`, plus the moved utils.

Existing `features/admin/` conventions to follow: kebab-case domain directories; `loan-report/` (thin page + feature hooks + presentational components) is the closest model; `kiosk-gmail-ingest-schedules/` shows pure `*Display.ts` helpers; co-located tests are used in `dgx-resource/`.

## Plan of Work

Step A4 (api): create `apps/api/src/services/production-schedule/production-schedule-query/` with sub-modules along the clusters above (suggested: `shared.ts` or `filters.ts` for SQL builders + raw page fetch, `leaderboard-shell.ts`, `leaderboard-decoration.ts`, `self-inspection-eligible.ts`, `signage-machine-board.ts`, `signage-auto-target.ts`, `list.ts`, `order-search.ts`, `resources.ts`, `order-usage.ts`, `types.ts`). `production-schedule-query.service.ts` becomes a pure re-export facade. Verbatim moves only; type-only imports between sub-modules where possible; no sub-module imports the self-inspection machine-board services.

Step W4a (web): extract SignageSchedulesPage pieces into `apps/web/src/features/admin/signage/` — pure helpers first, then the layout-config model (both directions of the conversion) with a new round-trip unit test, then the editor hook and presentational components. The page keeps its export name and route; target well under 300 lines.

Step W4b (web): same recipe for CsvImportSchedulePage into `apps/web/src/features/admin/csv-import/`, de-duplicating the create/edit timing fields and targets editor into single shared components with props, extracting the form hook and run hook, and moving the cron utils + their test. The page keeps its export name; `CsvImportPage.tsx` is not modified.

Each step is executed by a Composer 2.5 worker subagent; the orchestrator verifies against baseline before proceeding.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

API verification: `POSTGRES_PORT=5432 bash scripts/test/run-tests.sh` (container `postgres-test-local` already running on 5432; the explicit port export is required because the script auto-switches to 55432 when 5432 is occupied).

Web verification: `pnpm --filter @raspi-system/web exec tsc -b && pnpm --filter @raspi-system/web test && pnpm --filter @raspi-system/web lint`.

Cleanup after all verification: stop and remove `postgres-test-local` and its anonymous volume.

## Validation and Acceptance

Acceptance is behavioral equivalence: after each step the full relevant suite passes with the same counts as the baseline below, `tsc` is clean, and lint is clean. For Step A4, the 3 `vi.spyOn`-based tests and 4 `vi.mock`-based tests must pass unchanged, proving the facade surface survived. For W4a/W4b, the page routes render exactly as before (no import-site changes outside the page file and the new feature directory, except the small `csv-import-schedule-utils` move), and the new model round-trip tests pass.

## Idempotence and Recovery

Pure source refactorings; revert per file with `git checkout -- <path>` if a step's verification fails and forward-fix isn't obvious. The test Postgres container and volume are disposable.

## Artifacts and Notes

Baseline (2026-07-04 15:21+09:00, before any change; identical to phase 1/2 baselines):

    API (bash scripts/test/run-tests.sh):
      Test Files  412 passed | 2 skipped (414)
      Tests       2098 passed | 9 skipped (2107)
    Web (pnpm --filter @raspi-system/web test):
      Test Files  244 passed (244)
      Tests       1179 passed (1179)

These counts are the acceptance reference for every subsequent step.

Revision note (2026-07-04): initial version, written before step execution.

Operational revision note (2026-07-04 16:46+09:00): `72ff6550` committed/pushed, CI green, all-client production deploy `20260704-161204-25937` completed with all hosts `failed=0 / unreachable=0`, and Phase12 real-machine verification passed 45/0/0.
