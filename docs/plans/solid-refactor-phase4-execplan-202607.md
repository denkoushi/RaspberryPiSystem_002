# SOLID Refactor Phase 4 ExecPlan: env config partition and dashboard admin page split

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: solid-refactor-phase4-execplan-202607
- status: completed (implementation); committed `3042f8cd`, pushed, CI green; production deploy pending explicit user request
- scope: apps/api config/env.ts domain partition; apps/web CsvDashboardsPage.tsx and VisualizationDashboardsPage.tsx feature split
- date: 2026-07-04
- source_of_truth: this file
- related_docs: docs/plans/solid-refactor-execplan-202607.md (phase 1, deployed `893c7799`), docs/plans/solid-refactor-phase2-execplan-202607.md (phase 2, deployed `fe2d4a42`), docs/plans/solid-refactor-phase3-execplan-202607.md (phase 3, deployed `72ff6550`)

## Purpose / Big Picture

Phases 1–3 decomposed the web API client, two god route files, `apps/web/src/api/hooks.ts`, `self-inspection.service.ts`, `production-schedule-query.service.ts`, `SignageSchedulesPage.tsx`, and `CsvImportSchedulePage.tsx` using a facade-preserving mechanical recipe; all three phases are deployed to production. This phase continues down the open-item list with the next hotspots:

- `apps/api/src/config/env.ts` (554 lines, single `export const env` from one eager Zod parse) — partition the schema into domain sub-modules under `config/env/`, keeping `config/env.ts` as the facade that merges the partial schemas, applies the cross-domain `superRefine`, runs the single `envSchema.parse(process.env)`, and keeps exporting `env` so none of the 60 import sites change.
- `apps/web/src/pages/admin/CsvDashboardsPage.tsx` (916 lines) and `apps/web/src/pages/admin/VisualizationDashboardsPage.tsx` (700 lines) — decompose into `features/admin/csv-dashboards/` and `features/admin/visualization-dashboards/` (pure model helpers + presentational components + feature hooks), leaving each page as a thin composition, following the established `features/admin/signage/` and `csv-import/` patterns from phase 3.

All steps are strictly behavior-preserving. Success is observable by identical test results before and after each step. The two admin pages have no direct tests today, so the web steps additionally add unit tests for the extracted pure model layers (form sync/payload building for csv-dashboards; JSON config model and preset validation for visualization-dashboards) — test-only additions, no production behavior change.

Out of scope (carried open items): residual direct `lib/prisma` imports in ~26 non-test route files (requires new service-layer design decisions, not mechanical), shared loan orchestration extraction across tools/rigging/measuring-instruments.

## Progress

- [x] (2026-07-04 16:53+09:00) Working tree confirmed clean on `main` at `9457435a` (phase 3 merged, deployed, docs recorded).
- [x] (2026-07-04 16:58+09:00) Baseline verification green: API (`bash scripts/test/run-tests.sh`, container `postgres-test-local`) = Test Files 412 passed | 2 skipped (414), Tests 2098 passed | 9 skipped (2107). Web (`pnpm --filter @raspi-system/web test`) = Test Files 247 passed, Tests 1206 passed. Matches phase-3 final state.
- [x] (2026-07-04 16:58+09:00) Read-only structure exploration of all three targets done (two explore subagents). Key findings summarized in `Context and Orientation`.
- [x] (2026-07-04 17:15+09:00) Step A5 done (worker subagent): `config/env.ts` reduced from 554 to 104 lines (facade: dotenv-init first import, 10 shape fragments spread into one `z.object`, verbatim `superRefine`, unchanged `export const env = envSchema.parse(process.env)`). 11 new files under `apps/api/src/config/env/`: `load-dotenv.ts` (3), `core.ts` (54), `signage.ts` (24), `network.ts` (13), `alerts.ts` (49), `ingest-tuning.ts` (30), `kiosk-flags.ts` (26), `local-llm.ts` (59), `dgx-resource.ts` (89), `inference.ts` (72), `photo-tool.ts` (94). `core.ts` and `signage.ts` import `./load-dotenv.js` first (definition-time `NODE_ENV` reads). Verified by worker: `tsc -p tsconfig.build.json --noEmit` clean (the plain `tsc --noEmit` command fails on a pre-existing rootDir/include mismatch unrelated to this change), targeted 6 constraint test files / 26 tests green, full API suite 412 files / 2,098 tests (= baseline), lint clean. Orchestrator verified: all 137 env keys moved with set AND order identical to `git show HEAD:` (script comparison), facade export surface = `env` only, no `process.env` reads in sub-modules other than the two known definition-time defaults.
- [x] (2026-07-04 17:07+09:00) Step W5a done (worker subagent): `CsvDashboardsPage.tsx` reduced from 916 to 74 lines (thin composition; the save-button row stayed on the page). 11 new files under `apps/web/src/features/admin/csv-dashboards/`: `csvDashboardPresets.ts` (102), `csvDashboardFormModel.ts` (244), `csvDashboardFormModel.test.ts` (235, NEW: 16 cases — normalize/validate/sync TABLE+non-TABLE/buildUpdatePayload/applyDisplayNameChange/parseCsvHeaderCandidates/preset), `useCsvDashboardEditor.ts` (349), `CsvDashboardHeaderSection.tsx` (43), `CsvDashboardListSection.tsx` (34), `CsvDashboardBasicSettingsFields.tsx` (85), `CsvDashboardTableTemplateSection.tsx` (194), `CsvDashboardColumnDefinitionsTable.tsx` (95), `CsvDashboardPreviewSection.tsx` (79), `CsvDashboardUploadSection.tsx` (39). Known quirks preserved (preset fontSize 16 vs sync default 14; two independent reorder blocks; direct api/client data layer; width cleanup on display-column removal; FileReader preview). Verified by worker: `tsc -b` clean, lint 0 errors, web suite 248 files / 1,222 tests (= baseline 247/1,206 + exactly 1 new file / 16 new tests). Orchestrator verified: git footprint limited to the page file + new feature dir.
- [x] (2026-07-04 17:12+09:00) Step W5b done (worker subagent): `VisualizationDashboardsPage.tsx` reduced from 700 to 37 lines (thin composition). 9 new files under `apps/web/src/features/admin/visualization-dashboards/`: `visualizationDashboardPresets.ts` (145), `visualizationDashboardFormModel.ts` (272), `visualizationDashboardFormModel.test.ts` (270, NEW: 23 cases — parseJson, isDirty, togglePalletVizMachine order/key-removal, per-preset save validation, description empty→null), `useVisualizationDashboardEditor.ts` (267), `VisualizationDashboardHeaderSection.tsx` (25), `VisualizationDashboardListSection.tsx` (31), `VisualizationDashboardEditorForm.tsx` (181), `UninspectedCsvDashboardPicker.tsx` (44), `PalletVizMachinePicker.tsx` (63). Deviations (output-identical): measuring/rigging presets unified via `buildLoanInspectionPresetFields` factory; pallet-viz selected-set `useMemo` logic extracted to the model; `isCreating`↔`selectedId` exclusivity centralized in one hook handler; the create/edit form stays one component. Verified by worker: `tsc -b` clean, lint 0 errors, web suite 249 files / 1,245 tests (= 248/1,222 + exactly 1 new file / 23 new tests). Orchestrator verified: page now 37 lines, git footprint limited to the two page files + two new feature dirs (+ A5's env changes from the parallel worker).
- [x] (2026-07-04 17:27+09:00) Final verification (orchestrator): web `tsc -b` clean + suite 249 files / 1,245 tests (= baseline 247/1,206 + this phase's 2 new test files / 39 new tests) + lint clean. Full API suite: one run had a single failure (see Surprises — flaky, not reproducible), two subsequent full runs both exactly 412 files passed | 2 skipped, 2,098 tests passed | 9 skipped = baseline. Test container `postgres-test-local` and this session's anonymous volume (created 2026-07-04T07:54:06Z) removed; the 229 pre-existing dangling volumes untouched.
- [x] (2026-07-04 17:46+09:00) Committed and pushed to `origin/main`: `3042f8cd` (`refactor: split env config and dashboard admin pages`; 36 files, +3,576/−2,079; pre-commit lint hook passed). GitHub Actions all green for `3042f8cd`: CI `28700601324` success (watched to completion), CodeQL `28700601328` success, Secret scan `28700601342` success, Pages `28700600910` success. docs/INDEX.md link added.

Production deploy is intentionally NOT executed in this phase; it awaits an explicit user request (per repo safety rules).

Open items carried from phases 1–3 (not in this phase's scope):

- Remove remaining direct `lib/prisma` imports from route files (~26 non-test files; requires new service-layer design per route domain).
- Extract shared loan orchestration from tools/rigging/measuring-instruments loan services (`tools/loan.service.ts` 580, `measuring-instruments/loan.service.ts` 209, `rigging/loan.service.ts` 185).

## Surprises & Discoveries

- (2026-07-04) `env.ts` has exactly one export (`env`); no type exports, no `import * as`/`vi.spyOn` usage anywhere. The facade constraint is therefore much simpler than phase 3's A4 — but the module-load-time behavior (dotenv `config()` then eager `parse`, plus `process.env.NODE_ENV` read at schema-definition time for two defaults) adds an ESM evaluation-order hazard instead.
- (2026-07-04) One orchestrator full-API run showed a single test failure (1 failed / 2,097 passed) but the tail-truncated output lost the test name; the immediately following two full runs (one by the A5 worker, one by the orchestrator with full log capture) both passed with exact baseline counts. Treated as flaky/parallel-resource contention (three vitest suites had been running concurrently around that window), not a regression. If it recurs in CI, capture the full log first.
- (2026-07-04) `pnpm --filter @raspi-system/api exec tsc --noEmit` fails on a pre-existing TS6059 rootDir/include mismatch (prisma/scripts/vitest.config.ts outside `src`); the build config `tsc -p tsconfig.build.json --noEmit` is the meaningful typecheck and is clean. Pre-existing, unrelated to this phase.

## Decision Log

- Decision: Scope phase 4 to Steps A5 (env partition) and W5a/W5b (last two admin god pages); leave the ~26 route-file prisma imports and loan orchestration as open items.
  Rationale: A5 and W5 are mechanical facade-preserving splits with proven recipes; the prisma-import cleanup requires designing new service modules per route domain (behavioral judgment, higher risk, better as its own phase).
  Date/Author: 2026-07-04 / Fable 5 (orchestrator)
- Decision: For A5, keep dotenv `config()`, the merged schema assembly, the entire cross-domain `superRefine`, and the single `envSchema.parse(process.env)` in the facade `env.ts`; sub-modules export partial `z.object` shapes (or shape fragments) only and must be side-effect free, except that dotenv loading must be hoisted into a dedicated `config/env/load-dotenv.ts` imported first by the facade so `.env` values are loaded before any schema-definition-time `process.env` reads.
  Rationale: Two schema defaults (`LOG_LEVEL`, `SIGNAGE_RENDER_RUNNER`) read `process.env.NODE_ENV` when the schema object is constructed. ESM evaluates imported sub-modules before the facade body, so leaving `config()` in the facade body would flip the order. A first-imported side-effect module preserves the original sequence exactly.
  Date/Author: 2026-07-04 / Fable 5
- Decision: For W5a/W5b, allow adding new unit tests for extracted pure model functions, same as phase 3's Decision Log entry.
  Rationale: Neither page has any test; pure-function tests are the cheapest proof that the risky sync/build logic moved intact.
  Date/Author: 2026-07-04 / Fable 5
- Decision: Run A5 and W5a in parallel (api/web are independent), then W5b after W5a verifies.
  Rationale: Same as phase 3 — the two web steps share `features/admin/` conventions and the web test suite; serializing keeps verification unambiguous.
  Date/Author: 2026-07-04 / Fable 5
- Decision: Reuse the repo-standard disposable test container flow (`scripts/test/run-tests.sh`, container `postgres-test-local`) and remove it after final verification. No production/dev database is touched.
  Rationale: Same as phases 1–3.
  Date/Author: 2026-07-04 / Fable 5

## Outcomes & Retrospective

All three target modules were decomposed with zero behavior change, verified against the recorded baseline:

- `apps/api/src/config/env.ts`: 554 → 104 lines (facade over 11 files in `config/env/`; the single `env` export, merged schema, and verbatim cross-domain `superRefine` preserved; all 137 keys verified identical in set and order vs HEAD).
- `apps/web/src/pages/admin/CsvDashboardsPage.tsx`: 916 → 74 lines (thin composition over 11 files in `features/admin/csv-dashboards/`; the 15-setter form-sync effect now backed by pure model functions guarded by 16 new tests; known quirks like preset fontSize 16 vs sync default 14 intentionally preserved).
- `apps/web/src/pages/admin/VisualizationDashboardsPage.tsx`: 700 → 37 lines (thin composition over 9 files in `features/admin/visualization-dashboards/`; JSON-string config patching extracted to a pure model with 23 new tests; create/edit stays one shared form component).

Acceptance met: API suite 412 files / 2,098 tests identical to baseline (one flaky single-failure run did not reproduce across two subsequent full runs); web suite 249 files / 1,245 tests = baseline + exactly the 2 new test files / 39 new tests; typecheck and lint clean on both workspaces; `git diff --check` clean.

Operational acceptance:

- Commit: `3042f8cd` on `main`, pushed to `origin/main`.
- CI: CI `28700601324`, CodeQL `28700601328`, Secret scan `28700601342`, Pages `28700600910` — all success.
- Deploy: not executed; awaiting explicit user request.

Retrospective notes:

- The dotenv evaluation-order hazard (definition-time `process.env.NODE_ENV` reads in two defaults) was identified during exploration and neutralized by design (`load-dotenv.ts` as first import in the facade and in the two affected sub-modules) rather than discovered by a failing test — the `env.test.ts` resetModules suite would only have caught it indirectly.
- Verifying key set AND order against `git show HEAD:` with a small script is a cheap, high-confidence acceptance check for schema-partition refactors; worth repeating for similar splits.
- With three vitest suites running concurrently on one machine, a single flaky failure appeared in one full API run; when a run fails with truncated output, re-run with the log captured to a file before investigating.

Remaining hotspots for a future phase: residual direct `lib/prisma` route imports (~26 non-test files), shared loan orchestration extraction.

## Context and Orientation

The system is a pnpm monorepo: `apps/api` (Fastify 5 + Prisma 5 + Zod + vitest), `apps/web` (React 18 + Vite + TanStack Query v5 + vitest), `packages/` (shared pure logic). "Facade" here means: the original file path keeps exporting the exact same public symbols, but the implementations live in new sub-modules; import sites and `vi.mock` paths do not change.

Structure-exploration findings (2026-07-04):

`apps/api/src/config/env.ts` (554 lines):

- Single export: `export const env = envSchema.parse(process.env)` (line 554). No class, no mutable module state, no type exports. Internal: dotenv `config()` (line 7), `SECRET_MIN_LENGTH`/`WEAK_SECRET_PATTERNS`/`isWeakSecret` (lines 9–24, used only by the JWT production check), `envSchema` = `z.object({...}).superRefine(...)` (lines 26–552).
- Nine domain clusters: A core/server/db/metrics (27–57), B auth/JWT (51–54 + refine 533–551), C signage (58–75), D network/kiosk-slack (76–84), E alerts (86–130), F gmail-cleanup/due-mgmt tuning (132–157), G kiosk flags/rate-limit (158–179), H local LLM (180–234 + warm-window refine 482–491), I DGX resource (236–320), J inference providers (322–389 + alignment refine 510–531, imports `parseInferenceProvidersJsonQuiet`/`collectLocalLlmProviderAlignmentIssues` from `services/inference/config/`), K photo-tool/VLM/embedding (391–480 + refine 493–508).
- The `superRefine` block (481–552) crosses clusters B/H/J/K and must stay in one place (the facade), applied after merging partial schemas.
- Hazard: `LOG_LEVEL` and `SIGNAGE_RENDER_RUNNER` defaults read `process.env.NODE_ENV` at schema-definition time (lines 57, 63), so dotenv must load before any sub-module schema definition executes (see Decision Log).
- Import surface: 60 files, all `import { env } from '<rel>/config/env.js'`. Tests constraining the refactor: 4 × `vi.mock('.../config/env.js', () => ({ env: {...} }))` (photo-tool-label ×3, dgx-resource gateway-runtime), 1 × `vi.doMock` + `vi.resetModules` + dynamic import (`kiosk-document-summary-on-demand-runtime.test.ts`), and `config/__tests__/env.test.ts` (5 cases: weak-JWT dev/prod, inference/local-llm alignment throw, warm-window throw) which mutates `process.env`, calls `vi.resetModules()`, and dynamically imports `../env.js`. `vi.resetModules()` resets the whole registry, so sub-modules re-evaluate too — safe as long as sub-modules are side-effect free.
- Sibling conventions in `config/`: `camera.config.ts` (independent parse, `cameraConfig` export), `rate-limit.ts`. No `config/env/` directory yet.

`apps/web/src/pages/admin/CsvDashboardsPage.tsx` (916 lines):

- One exported page component, zero internal sub-components; module-level `MACHINE_DAILY_INSPECTION_DASHBOARD_NAME` + `buildMachineDailyInspectionPreset` (18–115); in-component `validateColumnDefinitions` (214–227).
- ~19 `useState` + one `useEffect([selected])` (155–207) that syncs 15+ setters from the fetched dashboard — must become a pure `syncFormFromDashboard`-style model function + one hook. Coupled state: `columnDefinitions`/`tableDisplayColumns`/`tableColumnWidths` (display-column removal also deletes widths, 584–590). `FileReader`-based CSV preview (821–828, calls `previewCsvDashboardParse` directly). No Context/DnD/refs-across-components.
- Data layer bypasses `api/hooks`: direct `useQuery` on `getCsvDashboards`/`getCsvDashboard` + mutations on `updateCsvDashboard`/`createCsvDashboard`/`uploadCsvToDashboard`; invalidates `['csv-dashboard', id]`, `['csv-dashboards']`, `['signage-content']`.
- Known quirk to preserve verbatim: preset `fontSize: 16` (line 103) vs form-sync default `14` (175, 193). The two ↑↓ reorder JSX blocks (549–580 vs 702–733) look alike but differ in setters/disabled logic — do not unify.
- Route: `App.tsx` L332; nav in `AdminLayout.tsx`. No tests reference the page.

`apps/web/src/pages/admin/VisualizationDashboardsPage.tsx` (700 lines):

- One exported page component; module constants/templates (9–72) + pure `parseJson` (76–90); handlers include JSON-string partial updates (`handleCsvDashboardIdChange` 138–160, `handlePalletVizMachineToggle` 190–222), `handleSave` validation (276–367), four `apply*Preset` functions (376–436, measuring vs rigging are structurally identical with different constants).
- `dataSourceConfig`/`rendererConfig` live as JSON strings in state; multiple handlers parse/patch/stringify — extract as a pure model (`extractCsvDashboardId`, `togglePalletVizMachine`, `computeIsDirty`, `buildSavePayload`, `parseJson`). Exclusivity between `isCreating` and `selectedId` (457–459, 249). `window.confirm` on delete (371). Create and edit share one JSX form block (487–694) with small conditional differences (status text, button label, delete button) — keep as one component.
- Data layer uses `api/hooks` (`useVisualizationDashboards`, `useVisualizationDashboard`, `useVisualizationDashboardMutations`, `useCsvDashboards`) + one inline `useQuery` for `getToolsPalletVisualizationBoard`.
- Route: `App.tsx` L338; nav in `AdminLayout.tsx`; `features/admin/signage/VisualizationDashboardGroupedSelect.tsx` links to the route (string only). No tests reference the page.
- Overlap between the two pages: shared API types only (already in `api/domains/csv-visualization.ts`); no shared JSX. Decompose independently, no shared sub-directory.

Existing `features/admin/` conventions to follow (from phase 3): kebab-case domain directories; thin page + `use<Domain>Editor.ts` feature hook + pure `*Model.ts`/`*Presets.ts` + `PascalCase` components with role suffixes (`*Section`, `*Form`, `*Table`); model/utils tests co-located.

## Plan of Work

Step A5 (api): create `apps/api/src/config/env/` with `load-dotenv.ts` (side-effect: dotenv `config()`) plus domain schema sub-modules along the clusters above (suggested: `core.ts` [A+B incl. the weak-secret helpers or a small `secret-strength.ts`], `signage.ts` [C], `network.ts` [D], `alerts.ts` [E], `ingest-tuning.ts` [F], `kiosk-flags.ts` [G], `local-llm.ts` [H], `dgx-resource.ts` [I], `inference.ts` [J], `photo-tool.ts` [K] — worker may adjust grouping if the verbatim key order suggests otherwise). Each sub-module exports a plain object of Zod field definitions (shape fragment) with keys moved verbatim. `config/env.ts` becomes: import `./env/load-dotenv.js` first, spread the shape fragments into one `z.object`, apply the verbatim `superRefine`, and `export const env = envSchema.parse(process.env)`. No import site changes; `config/__tests__/env.test.ts` and all mock-based tests must pass unchanged.

Step W5a (web): extract CsvDashboardsPage into `apps/web/src/features/admin/csv-dashboards/` — presets, pure form model (sync-from-server, normalize/validate column definitions, build update payload) with new unit tests, `useCsvDashboardEditor.ts`, and section components; page becomes a thin composition. Data-layer calls stay exactly as today (direct `api/client` usage moves into the hook unchanged — no migration to `api/hooks` in this phase).

Step W5b (web): extract VisualizationDashboardsPage into `apps/web/src/features/admin/visualization-dashboards/` — presets/templates, pure JSON config model with new unit tests, `useVisualizationDashboardEditor.ts`, and section components; the create/edit shared form stays one component.

Each step is executed by a Composer 2.5 worker subagent; the orchestrator verifies against baseline before proceeding.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

API verification: `POSTGRES_PORT=5432 bash scripts/test/run-tests.sh` (container `postgres-test-local` already running on 5432; the explicit port export is required because the script auto-switches to 55432 when 5432 is occupied).

Web verification: `pnpm --filter @raspi-system/web exec tsc -b && pnpm --filter @raspi-system/web test && pnpm --filter @raspi-system/web lint`.

Cleanup after all verification: stop and remove `postgres-test-local` and its anonymous volume.

## Validation and Acceptance

Acceptance is behavioral equivalence: after each step the full relevant suite passes with the same counts as the baseline below (plus exactly the new model test files for W5a/W5b), `tsc` is clean, and lint is clean. For Step A5, `config/__tests__/env.test.ts` (5 cases incl. two throw paths), the 4 `vi.mock` tests, and the `vi.doMock`/`resetModules` test must pass unchanged, proving the facade surface and module-load semantics survived. For W5a/W5b, no import-site changes outside each page file and its new feature directory.

## Idempotence and Recovery

Pure source refactorings; revert per file with `git checkout -- <path>` if a step's verification fails and forward-fix isn't obvious. The test Postgres container and volume are disposable.

## Artifacts and Notes

Baseline (2026-07-04 16:58+09:00, before any change; equals phase-3 final state):

    API (bash scripts/test/run-tests.sh):
      Test Files  412 passed | 2 skipped (414)
      Tests       2098 passed | 9 skipped (2107)
    Web (pnpm --filter @raspi-system/web test):
      Test Files  247 passed (247)
      Tests       1206 passed (1206)

These counts are the acceptance reference for every subsequent step.

Revision note (2026-07-04): initial version, written before step execution.
