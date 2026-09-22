---
title: Production schedule lookup ownership boundary
status: completed
scope: API schedule lookup, part measurement, mobile placement, pallet visualization
updated: 2026-09-22
---

# Production schedule lookup ownership boundary

This living ExecPlan follows `.agent/PLANS.md`. Its completion boundary is local implementation and validation. Commit, push, PR, merge and production deployment are not part of this execution.

## Purpose / Big Picture

Production schedule will own the existing schedule lookup used by part measurement, mobile placement and pallet visualization. Users must see the same candidates, selected rows, errors and snapshots. The change provides a small enforceable dependency boundary that can be expanded later without changing database identifiers or public HTTP responses.

## Progress

- [x] (2026-09-22) Read repository rules and run lifecycle audit; existing worktrees preserved.
- [x] (2026-09-22) Create `feat/production-schedule-lookup-boundary` from fetched `origin/main` at `44a6a696939c5c7a4cd8ed68f8abe8e9664a82bc`.
- [x] (2026-09-22) Baseline passed: 11 lookup cases (0.57s), 3 part-measurement and 3 pallet cases (initial run, unchanged expectations).
- [x] (2026-09-22) Move complete; unchanged old-entry lookup tests passed 11/11 (0.53s).
- [x] (2026-09-22) Migrated each group: part measurement 3/3 (0.35s), placement 17/17 (0.36s), pallets 3/3 (0.20s).
- [x] (2026-09-22) Scoped dependency rules, 56 positive/negative import probes, changed-file lint, API type check and a separate new-test type check passed. Mobile route integration: 4 selected cases passed.
- [x] (2026-09-22) After the user freed host storage, reran only the blocked self-inspection integration case: 1/1 passed (10.82s), unchanged code and capacity guard. Available space 30.15 GiB exceeded the 11.41 GiB reserve; disposable resources were removed successfully.
- [x] (2026-09-22) Recorded final diff, explicit residual dependencies and recovery; disposable DB/container/volume/storage cleanup returned TEMP_RESOURCE_REMAINING=0.

## Surprises & Discoveries

The audited starting checkout was detached at `a71968c`; the freshly fetched main is `44a6a696`. Relevant lookup, lifecycle, quality rules and lockfile are unchanged between those revisions. The system Python 3.9 cannot run the lifecycle tool's `StrEnum`; a Python version supporting StrEnum runs it. Corepack resolves the repository-required pnpm 9.15.9; the bundled generic pnpm resolves 11 and must not be used.

The shared `scripts/test/start-postgres.sh` removes an existing named test container. Use `scripts/test/work-instructions-validation.sh` instead: it allocates a unique container, volume and loopback port, overrides DATABASE_URL and storage paths, and removes only the resources it created. Existing integration tests perform broad table cleanup, so execute only inside this disposable database and without concurrent files.

The first baseline run passed 14 cases; one proposed overflow fixture failed during insertion, before lookup. The existing PostgreSQL expression index casts FKOJUN to int and rejects out-of-range values. Replace that unreachable lookup fixture with explicit query-failure injection for all three lookups; keep the real SQL fixtures and their expectations unchanged. This is a test setup correction before moving production code.

The additional self-inspection integration case exercises `/self-inspection/sessions/resolve-or-create`, whereas the changed resolver serves `/part-measurement/resolve-ticket`. Its initial image upload hit the pre-existing storage guard on this host. Following the bounded-validation rule, the initial check was stopped without altering storage policy or unrelated tests. The user then freed host storage, and a single targeted rerun passed without code or assertion changes. The direct resolver behavior is covered by the focused tests and its SQL by the PostgreSQL contract tests.

## Decision Log

Decision (2026-09-22): transfer the existing seven-field read contract without introducing a new business model. The field names and CSV row ID already have consumers; keeping them separates ownership changes from semantic changes. The production schedule module owns this compatibility contract and its SQL implementation.

Decision (2026-09-22): use a dedicated lookup module rather than the existing broad production-schedule query facade. That facade reaches back into inspection, creating an unnecessary reverse dependency for this small lookup.

Decision (2026-09-22): preserve old exports and type aliases. They provide a reversible transition. Remove them only in a separately reviewed change after repository-wide production and test callers have been migrated; the part-measurement barrel remains an explicit compatibility exception for this task.

## Outcomes & Retrospective

Local implementation and the selected local validation are complete. The final focused checks passed 35 tests across the lookup, part measurement, placement and pallet consumers; four mobile route integration cases and the additional self-inspection session integration case also passed, for 40 distinct selected tests. The first self-inspection attempt was blocked by the host capacity guard before lookup. After the user freed storage, the same case passed unchanged in 10.82s with a fresh disposable database. Capacity guards and test expectations were preserved. Scoped import probes (56), lint, API and new-test type checks, diff checks and disposable-resource cleanup passed. No commit, push, PR, merge or production connection/deployment was performed. Completion is limited to the approved first lookup boundary and local validation; CSV-independent business identity and broader architecture stages remain future work.

## Context and Orientation

`apps/api/src/services/part-measurement/part-measurement-schedule-lookup.service.ts` currently implements ProductNo lookup, FSEIBAN lookup and machine-name aggregation. It directly reads `CsvDashboardRow`, the fixed production dashboard and production schedule winner SQL. Placement and pallets reuse it through the inspection module. Some callers choose the first candidate, making output ordering observable behavior.

Move it to `apps/api/src/services/production-schedule/production-schedule-lookup.service.ts`. Keep the old file as re-exports and retain `PartMeasurementScheduleRowCandidate` as an alias of `ProductionScheduleLookupRow`. Preserve `part-measurement/index.ts` exports.

The six production consumers are `part-measurement/part-measurement-resolve.service.ts`, `mobile-placement/mobile-placement-order-lookup.ts`, `mobile-placement/haizen-placement.service.ts`, `mobile-placement/mobile-placement-order-placement.service.ts`, `mobile-placement/mobile-placement-slip-match.ts`, and `pallet-visualization/pallet-visualization-schedule-resolver.ts`, all below `apps/api/src/services/`.

## Plan of Work

### Milestone 1: characterize current behavior

Create `production-schedule/__tests__/production-schedule-lookup.service.test.ts` with real PostgreSQL fixtures and initial imports from the old entry point. Check winner selection before product filtering, numeric ordering, createdAt/id tie breaking, dashboard scope, integer/null conversion, complete seven-field results, candidate ordering, missing required fields, trimming, case-sensitive matching, empty inputs without queries, machine-name aggregation and unchanged propagation of database failures. Fixtures clean up only their own rows and dashboards.

Add focused resolver tests under part-measurement and pallet-visualization. Mock only lookup and persistence boundaries, retaining the real candidate filtering and snapshot assembly. Run these tests against unchanged production code first.

### Milestone 2: transfer implementation

Move the original function bodies and SQL without modification; change relative imports and the exported type name. Explain in the contract comment that rowId is a CsvDashboardRow.id, and preserve the existing field meanings. Replace the old implementation with re-exports. Recheck the baseline lookup tests while callers still use the old path.

### Milestone 3: migrate consumers

Change only imports and type references, first part measurement, then placement, then pallets. Update matching mocks and type-only test imports. After each group, run its focused behavior tests. Finally test the new lookup directly using the same expected results and prove the legacy named functions are identical re-exports with compatible types.

### Milestone 4: enforce and validate

In `apps/api/.eslintrc.cjs`, add an override for the six migrated production consumers. Forbid the old lookup path and named lookup imports through the part-measurement barrel. Keep the compatibility file and barrel outside the override. A second override covers the new lookup, seiban-progress, effective-completion SQL, constants and row-resolver files; forbid imports of the three consuming domains and the broad query facade. Preserve existing rules.

Use ESLint's API with synthetic imports and real file paths to prove forbidden direct imports, barrel imports and reverse imports fail, while the new public import is accepted. Then lint changed TypeScript and run API build type checking. Run only the affected mobile placement and part measurement route integration cases after the focused tests pass.

## Concrete Steps

Run commands from the task worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--production-schedule-lookup-boundary`. Use Node on `/opt/homebrew/opt/node@24/bin`, Corepack and pnpm 9.15.9; keep package.json and pnpm-lock.yaml unchanged.

    corepack pnpm install --frozen-lockfile --offline --ignore-scripts
    corepack pnpm --filter @raspi-system/api exec prisma generate
    corepack pnpm --filter '@raspi-system/api^...' build

Run database commands through the disposable wrapper with a minimal environment containing tool paths, Docker configuration and test-only values, without application credentials or a production .env file. Set SIGNAGE_RENDER_DIR to the wrapper's temporary root and PI5_SCHEDULER_LEADER_ENABLED=0. Inside it, run migrations only to prepare the disposable database, then selected Vitest files:

    corepack pnpm --filter @raspi-system/api exec prisma migrate deploy
    corepack pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/production-schedule-lookup.service.test.ts src/services/part-measurement/__tests__/part-measurement-resolve.service.test.ts src/services/pallet-visualization/__tests__/pallet-visualization-schedule-resolver.test.ts --fileParallelism=false

After consumer migration include existing `mobile-placement-slip-match.test.ts` and `haizen-placement.service.test.ts`. Integration validation selects schedule-resolution cases from `src/routes/__tests__/mobile-placement.integration.test.ts` and `src/routes/__tests__/part-measurement.integration.test.ts`. Record exact selected commands and outcomes below. Type-check with `corepack pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json` and run ESLint for changed files.

## Validation and Acceptance

The same baseline fixture expectations must pass before and after the move; do not update them to accommodate a behavior difference. One nonempty lookup performs one SQL query, and blank inputs perform none. Existing sorting remains `fkojun ASC NULLS LAST, fhincd ASC`; no extra tie-breaking is introduced. Existing winner selection, dashboard ID, string normalization, null and exception behavior remain intact.

Accept when the three implementations exist once under production schedule, all six known production consumers use it, legacy imports still work, focused/integration checks pass, boundary violations are caught, and type checking plus diff checks succeed. Stop at a causal failure, fix that change, and record unrelated baseline failures without broadening scope. The local validation budget is 20 minutes; do not repeat successful unchanged checks.

## Idempotence and Recovery

There are no schema, migration, ID, public API or configuration changes. Within this worktree, reverse consumer changes before removing their new lookup dependency, then restore the old implementation if necessary. Do not reset another worktree or remove user work.

No deployment is included. A future approved deployment uses the existing Pi5 API/Web release set, exact SHA/digests and standard Ansible Blue/Green path. Mid-release failure is handled by the role's rescue rollback. After a successful release old slot containers may be deleted; a later business regression requires a validated reverted release through the standard route, not manual container or database changes.

## Artifacts and Notes

Lifecycle start returned `worktree_created=true`, `origin_main_sha=44a6a696939c5c7a4cd8ed68f8abe8e9664a82bc`, with no warnings. Dependencies installed offline with unchanged lockfile (878 packages). Final evidence: old-entry PostgreSQL baseline 11/11 (0.57s), moved implementation through the same old entry 11/11 (0.53s), migrated part resolver 3/3 (0.35s), placement 17/17 (0.36s), pallet resolver 3/3 (0.20s), final public entry plus legacy identity 12/12 (0.49s). These are staged runs, not distinct cumulative coverage; final distinct passing test count including the four mobile integration cases and the later self-inspection rerun is 40.

The integration command was:

    corepack pnpm --filter @raspi-system/api exec vitest run src/routes/__tests__/mobile-placement.integration.test.ts src/routes/__tests__/part-measurement.integration.test.ts -t 'verify-slip-match|register-order-placement creates|resolves, saves, and completes a self-inspection session' --fileParallelism=false

It completed in 18.50s with four passes and one storage-blocked failure; 94 unrelated cases were not selected. The failure was at the initial visual-template upload assertion, `part-measurement.integration.test.ts:2678`. This was retained as a pending check until the user freed storage; no code or test expectations were changed to conceal the failure.

On 2026-09-22, filesystem statfs showed 30.15 GiB available against an 11.41 GiB reserve. The existing disposable wrapper created a fresh container and volume, used a dynamic loopback PostgreSQL port and temporary storage, and applied migrations only to that disposable DB. With a minimal environment and the same scheduler/storage settings, run:

    corepack pnpm --filter @raspi-system/api exec vitest run src/routes/__tests__/part-measurement.integration.test.ts -t 'resolves, saves, and completes a self-inspection session' --fileParallelism=false

Result: TEST_EXIT=0, 1 selected test passed, 71 unrelated tests not selected; duration 10.82s (case 1.30s). The wrapper then exited 0 with TEMP_RESOURCE_REMAINING=0 and no inventory differences. This closes the only pending local validation. Previously successful checks were not rerun because source code was unchanged.

Changed TypeScript files passed ESLint. The configured boundary was exercised with ESLint.lintText using real consumer/internal file paths: old direct and type imports, named/namespace barrel imports and reverse consumer imports were rejected; new public imports, internal Prisma use and compatibility re-exports were accepted (56 probes). API `tsc --noEmit -p tsconfig.build.json` passed. A separate temporary tsconfig including only the three new test files also passed; its first attempt needed an explicit typeRoots path because the config lived outside the worktree.

A source comparison against HEAD normalized only imports, the public type rename and the new ownership comment. It verified byte-identical SQL/function bodies and unchanged bodies in all six consumers. `git diff --check` passed. The original Pi checkout remained clean at a71968c; the DGX checkout stayed at 5b389d0 with its two pre-existing character-chat modifications untouched. The disposable wrapper reported `TEMP_RESOURCE_REMAINING=0` with no inventory differences.

## Interfaces and Dependencies

The new module exports `ProductionScheduleLookupRow` with string fields rowId, fseiban, productNo, fhincd, fhinmei and fsigencd, plus fkojun: number | null. It exports `listScheduleRowsByProductNo(string): Promise<ProductionScheduleLookupRow[]>`, `listScheduleRowsByFseiban(string): Promise<ProductionScheduleLookupRow[]>`, and `resolveMachineNameForSeiban(string): Promise<string | null>`.

Use existing Prisma, winner SQL and seiban-progress implementations. No dependencies, service container, generic repository layer or feature flag are added. Raw snapshot reads in placement/pallets, resource policy dependencies in part measurement and assembly's distinct lookups remain explicitly outside this first boundary. Stable business IDs, cross-repository contracts, shared connections/jobs and multiple sites/resources are later separately planned stages.

Revision note (2026-09-22): initial implementation plan records the approved limited scope, exact baseline and reversible milestones.

Revision note (2026-09-22): recorded completed implementation, staged test evidence, unchanged source-body comparison, resource cleanup and the unresolved host-capacity limitation in the additional integration check.

Revision note (2026-09-22): user resolved local disk capacity; the unchanged pending integration case passed once in a fresh disposable environment. Marked local implementation and selected validation complete, without widening to repository publication or deployment.
