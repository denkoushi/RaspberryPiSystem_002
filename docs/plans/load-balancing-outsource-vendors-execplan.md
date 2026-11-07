# Vendor-aware kiosk load balancing

This living ExecPlan follows `.agent/PLANS.md`. Only local implementation and validation are authorized; integrationPending (commit, push, PR, merge and deploy are outside this task).

## Purpose / Big Picture


The kiosk will select an actual eligible vendor, respect every displayed month's receiving limit, and show the selected work and work with no destination beside the resource heatmap. Operators can edit vendors through ⚙ and run one automatic selection over all overloaded cells. The calculation must be reproducible without React.

## Progress


- [x] (2026-11-07) Read survey, approved mock, safety, quality, git, UI, documentation and plan rules; initial worktree clean.
- [x] (2026-11-07) Add database models, migration, validated kiosk settings routes and cache wiring.
- [x] (2026-11-07) Implement pure calculation, manual checks and deterministic automatic selection.
- [x] (2026-11-07) Implement approved layout, vendor menus, grouped output and settings editor.
- [x] (2026-11-07) Add boundary tests and 400 seeded property cases; execute required validation commands.
- [ ] API full-project typecheck and actual 1920×1080 browser check remain unverified (existing config/type errors and sandbox restrictions).
- [x] (2026-11-07) Update KB/guide and final evidence; recheck worktree (all changes belong to this task, initial tree clean).

## Surprises & Discoveries


Capacity, calendars, classes and transfer rules are read outside the source cache and serialized into the derived-result settings key. Vendor settings must join this key. The source cache itself remains unchanged.
A stale source may survive a JST date change; settingsKey previously excluded today and could reuse the previous day's assembled result. Adding today to settingsKey ensures overdue receiving usage uses the current month. The new date-boundary test passes.
The approved mock has no daily graph; the UI now shows due dates instead of the former period strip, and removes the daily graph read/display. The existing workspace/day API and client function remain available.
Vendor edits invalidate trial history, so undo cannot restore allocations to a removed vendor.
The lifecycle read-only audit could not reach api.github.com; the existing task branch/worktree is reused without any git mutation.

## Decision Log


- Decision: Preserve daily allocation and effective-due-date resolution from the API. Use total FSIGENSHOYORYO minutes for per-row eligibility and sort by due ascending, total minutes descending, vendor priority ascending in the configured key order; break ties by rowId/vendorId ascending.
  Rationale: User's fixed calculation contract; ProductNo is not an action identity.
  Date/Author: 2026-11-07 / Codex.
- Decision: Keep stable vendor IDs within an authoritative site settings snapshot. No site snapshot means shared fallback; any site snapshot (including zero vendors) replaces the complete shared snapshot, including mode and order. Saving copies the effective list into the site snapshot atomically.
  Rationale: This supports rename, priority changes and deletion without shared entries reappearing. Names need not be unique; IDs must be unique.
  Date/Author: 2026-11-07 / Codex.
- Decision: Vendor matching alone uses NFKC, trim, collapsed whitespace and uppercase for part code/name, and trim/NFKC/uppercase for resource codes. Keep normalizeComparisonText unchanged; machine filters/display use normalizeMachineName without truncation.
  Rationale: Halfwidth kana must match fullwidth kana in vendor conditions without changing comparison behavior elsewhere.
  Date/Author: 2026-11-07 / Codex.
- Decision: Store minutes as finite nonnegative floating values so fractional-hour editor input is not truncated. NULL means unlimited/unrestricted; zero remains a real zero limit. An empty resource list means all resources; an empty conditions list means no capability. Conditions AND within a row and OR across rows.
  Rationale: User's fixed contract and fractional daily allocations.
  Date/Author: 2026-11-07 / Codex.
- Decision: Rebuild resource loads and vendor usage from the final action set on each automatic step. For late allocations charge JST today's month, even when the displayed range starts later; ignore normal allocations outside the displayed range.
  Rationale: Late work is explicitly charged to the current month rather than the first displayed month.
  Date/Author: 2026-11-07 / Codex.
- Decision: Default to process mode and due → minutes → vendor order. Part mode groups by FSEIBAN+FHINCD, adding ProductNo only for ********, and includes only eligible, unacted, allocated rows inside the machine filter. Save a group identifier on actions so undo/cancel remains atomic even after mode changes.
  Rationale: User's fixed grouping contract, with stable cancellation semantics.
  Date/Author: 2026-11-07 / Codex.
- Decision: Process largest excess first, exclude late/NULL capacity, include zero capacity, threshold 0.5 minutes. Try internal transfers before outsourcing, validating all months with minutes/efficiencyRatio. Recompute all cells after changes and retain a bounded loop. Report remaining eligible rows as 条件 or 上限, in due order until their minutes cover remaining excess.
  Rationale: User's fixed automatic and manual contracts. No operation is assigned to unallocated or filtered-out rows.
  Date/Author: 2026-11-07 / Codex.

- Decision: Use a finite automatic-step bound of row count + resource/month cell count + 1. Finish the current cell before selecting the next largest recalculated cell. Only automatic selection creates no-destination rows. Manual changes, cancellation and undo only remove acted rows from the current no-destination list; machine filtering affects its display only.
  Rationale: Every successful step consumes an untouched row and every unsuccessful step exhausts a cell; this bound prevents loops without truncating a large valid input and inventing a failure reason.
  Date/Author: 2026-11-07 / Codex.
- Decision: Include JST today in the derived-result settings key and discard trial/history when vendor settings change.
  Rationale: A stale source can cross midnight; overdue receiving usage must still charge the true current month. Old trials must not resurrect deleted vendors after a settings edit.
  Date/Author: 2026-11-07 / Codex.

## Outcomes & Retrospective


Local implementation is complete and uncommitted. Web targeted validation passed 456 tests across 6 files, including 400 seeded property cases. API targeted validation passed 87 tests across 17 files, using mocks/fixtures without a DB. Web TypeScript, API production-source TypeScript, Prisma generation/validation and changed-file ESLint passed. The specified API full-project TypeScript command remains unsuccessful because rootDir=src includes files outside src; an additional rootDir override exposed numerous pre-existing test-fixture type errors. No unrelated files were repaired. No DB migration has been applied and no production resources have been contacted. Actual 1920×1080 browser validation is still outstanding because sandbox networking/browser launch failed. Commit, push, PR, merge and deploy were not performed; integrationPending.

## Context and Orientation


`apps/api/src/services/production-schedule/load-balancing/load-balancing-workspace.assembler.ts` distributes each resolved CSV process row over working days and returns rowId plus monthly allocations. `load-balancing-workspace.service.ts` merges current settings into those rows. `apps/web/src/features/kiosk/loadBalancing/loadBalancingScenario.ts` places rows after trial actions. New pure functions beside that file own vendor matching, monthly usage, grouping and automatic selection. `LoadBalancingWorkspace.tsx` and the kiosk page render their results. A trial action changes only local state, never production orders.

## Plan of Work


Milestone 1 adds a site snapshot, child vendors and conditions to Prisma and a hand-authored additive SQL migration. A dedicated settings service validates and atomically saves the snapshot. GET/PUT kiosk routes use the existing x-client-key and proxy scope resolution. The workspace reads current settings on every request, including cached source requests. Mocked service and route tests prove persistence calls, fallback, validation and authorization.

Milestone 2 adds pure functions taking rows/allocations, capacities, transfer rules, vendor settings, normalized machine filter and JST today. They return actions and no-destination rows. Manual menus use the same feasibility functions. Unit tests cover monthly and late usage, row eligibility, grouping, ordering, determinism and efficiency. Seeded random cases independently verify conservation, limits, eligibility and transfer capacity.

Milestone 3 moves detail under the heatmap, adds the vendor output at right and header controls/KPI. The settings dialog follows the approved mock: vendor ordering/list, editable conditions, process/part mode and key ordering. Local history snapshots make one undo restore one user operation, including grouped and automatic actions. Failed saves remain visible in the editor.

Milestone 4 runs requested targeted tests, both TypeScript checks, changed-file ESLint, and updates the KB and guide with short rules and links to this plan. Visual validation uses bundled Chromium only if available, never installed Chrome.

## Concrete Steps


Run in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--load-balancing-outsource-vendors`:

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/loadBalancing src/pages/kiosk/ProductionScheduleLoadBalancingPage.test.tsx
    pnpm --filter @raspi-system/web exec tsc --noEmit -p .
    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/load-balancing src/routes/kiosk/production-schedule/__tests__/load-balancing.test.ts
    pnpm --filter @raspi-system/api exec tsc --noEmit -p .

Run ESLint from each app with only changed .ts/.tsx files. Do not reinstall dependencies, read .env, apply migrations or access devices. Record actual counts/results below.

## Validation and Acceptance


A two-month row may be outsourced only when the selected vendor has space in both months; its total process minutes govern its condition limit. A late row consumes the true current month. A zero-limit vendor accepts nothing; an unlimited vendor accepts matching rows. Part grouping never merges unrelated ******** orders. Automatic selection respects the machine filter, exhausts valid internal transfers first, and assigns remaining failures a reason. At least 300 fixed-seed cases must satisfy independent time conservation and limit checks. The mock's 1920×1080 layout must show the heatmap/detail at left, vendor output at right and one global automatic button.

## Idempotence and Recovery


SQL adds tables only and is not executed during this task. The settings write uses a transaction and replaces only the resolved site's snapshot; validation failures leave stored settings unchanged. Local trial state can be undone or cleared. Source code edits remain uncommitted and reviewable; initial worktree contained no user WIP.

## Artifacts and Notes


Survey and approved mock were read from the sibling `_notes` directory without modifying them. Validation evidence (Node 24.3.0, pnpm 12.16.1; validation work stayed below the 45-minute DB-change budget):

    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/loadBalancing src/pages/kiosk/ProductionScheduleLoadBalancingPage.test.tsx
    PASS: 6 files, 456 tests, 3.24 seconds (400 seeded cases).

    pnpm --filter @raspi-system/web exec tsc --noEmit -p .
    PASS (approximately 20 seconds).

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/load-balancing src/routes/kiosk/production-schedule/__tests__/load-balancing.route.test.ts
    PASS: 16 files, 84 tests, 5.97 seconds. No DB required.

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/production-schedule-settings.service.test.ts
    PASS: 1 file, 3 tests, 0.39 seconds. API total: 87 tests in 17 files.

    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/loadBalancing/__tests__/loadBalancingOutsource.test.ts
    PASS: final focused check, 427 tests including 400 seeded cases, 0.93 seconds.

    pnpm --filter @raspi-system/api exec tsc --noEmit -p .
    FAIL: TS6059, rootDir=src versus included prisma/seed.ts, scripts and vitest.config.ts.

    pnpm --filter @raspi-system/api exec tsc --noEmit -p . --rootDir .
    FAIL: default Node heap exhausted (~30 seconds).

    NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @raspi-system/api exec tsc --noEmit -p . --rootDir .
    FAIL: numerous existing test-fixture type errors. No production-source diagnostic.
    Two unknown-error accesses in the touched route test were corrected; unrelated fixtures were not changed.

    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json
    PASS: production source (approximately 20 seconds).

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec prisma validate
    PASS. Generation only; no migration execution or dependency reinstall.

    pnpm --filter @raspi-system/web exec eslint <all changed Web TS/TSX paths>
    pnpm --filter @raspi-system/api exec eslint <all changed API TS paths>
    PASS, no warnings. The final calculation edits also received a focused lint/test pass.

    git diff --check
    PASS.

Start lifecycle audit could not reach api.github.com. The final read-only audit succeeded; no cleanup, branch update, main sync or other git mutation was performed.
Vite preview failed to listen on 127.0.0.1:5178 (EPERM). Installed bundled Chromium headless shell failed to launch under the sandbox. No installed Chrome was launched. Per repository browser rule, browser QA was skipped; no screenshot or true one-screen-fit assertion is claimed. Vitest also emitted an existing baseline-browser-mapping age warning; dependencies were not changed. Migration/transaction behavior against a real DB is not verified; only schema validation and mocked persistence tests were run.

Changed files (repository-relative paths; no pre-existing WIP):

    apps/api/prisma/schema.prisma
    apps/api/prisma/migrations/20261107120000_load_balancing_outsource_vendors/migration.sql
    apps/api/src/routes/kiosk/production-schedule/load-balancing.ts
    apps/api/src/routes/kiosk/production-schedule/__tests__/load-balancing.route.test.ts
    apps/api/src/services/production-schedule/load-balancing/load-balancing-outsource-settings.service.ts
    apps/api/src/services/production-schedule/load-balancing/__tests__/load-balancing-outsource-settings.service.test.ts
    apps/api/src/services/production-schedule/load-balancing/load-balancing-workspace.service.ts
    apps/api/src/services/production-schedule/load-balancing/load-balancing-workspace.types.ts
    apps/api/src/services/production-schedule/load-balancing/__tests__/load-balancing-workspace.service.test.ts
    apps/web/src/api/domains/production-schedule/load-balancing.ts
    apps/web/src/api/hooks/production-schedule/load-balancing.ts
    apps/web/src/features/kiosk/loadBalancing/loadBalancingScenario.ts
    apps/web/src/features/kiosk/loadBalancing/LoadBalancingWorkspace.tsx
    apps/web/src/features/kiosk/loadBalancing/LoadBalancingCellDetail.tsx
    apps/web/src/features/kiosk/loadBalancing/LoadBalancingOutsourcePanel.tsx
    apps/web/src/features/kiosk/loadBalancing/LoadBalancingOutsourceSettings.tsx
    apps/web/src/features/kiosk/loadBalancing/LoadBalancingPageHeader.tsx
    apps/web/src/features/kiosk/loadBalancing/LoadBalancingScenarioBar.tsx
    apps/web/src/features/kiosk/loadBalancing/__tests__/loadBalancingScenario.test.ts
    apps/web/src/features/kiosk/loadBalancing/__tests__/loadBalancingOutsource.test.ts
    apps/web/src/pages/kiosk/ProductionScheduleLoadBalancingPage.tsx
    apps/web/src/pages/kiosk/ProductionScheduleLoadBalancingPage.test.tsx
    docs/guides/kiosk-production-schedule-load-balancing.md
    docs/knowledge-base/KB-362-kiosk-load-balancing.md
    docs/plans/load-balancing-outsource-vendors-execplan.md

## Interfaces and Dependencies


Use existing Prisma, Fastify, Zod, React and TanStack Query; add no dependency. `autoSelect` returns `{ actions, noTaker }`; `aggregateScenario` rebuilds `{ matrix, vendorUsage }`; `outsourceOption` and `transferOptions` are shared by automatic selection and manual UI. All functions use rowId identities, never ProductNo alone.

Revision 2026-11-07: Initial plan records fixed decisions, persistence semantics and validation boundaries before implementation.

Revision 2026-11-07: Found existing production schedule part-name comparison normalization during detailed UI inspection; reuse it for vendor predicates.

Revision 2026-11-07: Completed implementation and recorded local evidence, per-cell ordering, loop-bound proof, JST stale-source handling, and the remaining API-type/browser/DB validation limits.
