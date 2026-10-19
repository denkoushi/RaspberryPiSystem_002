---
title: Production schedule snapshot ownership boundary
status: completed
scope: Order placement registration, haizen scan, pallet item registration and list fallback
updated: 2026-09-22
---

# Production schedule snapshot ownership boundary

This living ExecPlan follows `.agent/PLANS.md` and continues the completed lookup ownership plan. Completion means a reviewable local diff and targeted validation, not commit, push, PR or deployment.

## Purpose / Big Picture

The three registration paths already obtain candidates from production schedule. They still read the selected CSV row themselves. Move that read and column extraction behind a production-schedule-owned snapshot service, so future storage changes have fewer consumer touch points. Preserve all persisted JSON, HTTP results, selection rules, errors and Prisma read shapes/counts. No schema, migration, stable business ID or behavior changes are included.

## Progress

- [x] (2026-09-22) Resume the existing worktree at base `44a6a696939c5c7a4cd8ed68f8abe8e9664a82bc`; save the completed first-stage delta as a local recovery reference.
- [x] (2026-09-22) Inspect all three read paths and the separate batch/barcode policies; define this limited scope.
- [x] (2026-09-22) Before production edits, 34 characterization tests passed across order placement (7), haizen (16), pallet resolution (6) and display fields (5); 0.642s.
- [x] (2026-09-22) Added the owned reader and dimension helper, preserved old helper exports, and switched the three consumers; baseline expectations unchanged.
- [x] (2026-09-22) Validation passed: 34 unchanged consumer cases, 9 real PostgreSQL contract cases, 2 selected mobile route integrations and 1 pallet concurrency integration (46 distinct cases); lint, API/test types and 89 boundary probes passed.
- [x] (2026-09-22) Recorded results, remaining reads, compatibility ownership and recovery. Disposable cleanup returned TEMP_RESOURCE_REMAINING=0 with no inventory differences; original checkouts preserved.

## Surprises & Discoveries

The post-candidate reads use only row ID, while the pallet supplement relation alone filters by the fixed production dashboard. Preserve that asymmetry. The separate pallet list query does not use the same supplement filter; it cannot be folded into this contract without its own characterization. A missing selected row is a 404 in order/pallet registration but an UNRESOLVED event in haizen. Raw fields preserve JSON values (including false, zero, arrays, objects and whitespace); normalization would change stored history.

## Decision Log

Decision (2026-09-22): expose semantic snapshot fields as Prisma.JsonValue. This is a historical-value read contract, not a validated domain entity. rowId remains CsvDashboardRow.id. Do not introduce generic rowData into the new interface. Existing stored ProductNo/FSEIBAN/FHINCD/FHINMEI/FSIGENCD keys remain in each consumer's persistence mapping.

Decision (2026-09-22): keep placement and pallet reader functions separate, preserving their exact projections and one findFirst call. Move dimension-column aliases and extraction into production schedule. Keep the old pallet helper exports as compatibility re-exports; their owner is production schedule, and deletion requires migration of the remaining pallet list/test callers in a separate change.

Decision (2026-09-22): leave dashboard-scoped barcode validation in mobile-placement.service.ts, mobile-placement/part-search, pallet-visualization-query.service.ts batch fallback, and assembly searches for separately scoped steps. No cross-repository change is needed.

## Outcomes & Retrospective

The bounded follow-on is complete locally. Order placement, haizen and pallet registration now depend on the production schedule snapshot contract rather than CsvDashboardRow or CSV column extraction. Original snapshot JSON, missing-row differences, query projections and candidate selection remain covered by unchanged assertions. The previous lookup implementation and all unrelated first-stage changes were preserved. No schema, migration, API, ID, dependency or deployment changes were made. Remaining barcode/list/part-search/assembly readers still need independent contracts; this is one additional boundary, not completion of the ten-year architecture roadmap.

## Context and Orientation

Work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--production-schedule-lookup-boundary`. Under apps/api/src/services, mobile-placement/mobile-placement-order-placement.service.ts and mobile-placement/haizen-placement.service.ts read id/rowData after selecting a candidate. pallet-visualization/pallet-visualization-schedule-resolver.ts also reads the first filtered supplement and builds dimensions/date displays. The previous lookup plan remains the source of evidence for candidate SQL and compatibility exports.

## Plan of Work

First add focused consumer fixtures to fix full persisted snapshots, missing-row behavior, fallback labels, raw JSON, first-row selection, errors and exact Prisma calls. Run before moving production code and keep expectations unchanged. Then add production-schedule-snapshot.service.ts and the pure production-schedule-snapshot-fields.ts helper, moving the reads with no additional query. Switch placement, haizen and pallet consumers. Finally enforce scoped dependency rules, prove forbidden/allowed examples, and validate actual PostgreSQL rows/supplements plus affected route/command integrations.

## Concrete Steps

Use Node 24 and repository pnpm 9.15.9 through corepack. Unit files are mobile-placement-order-placement.service.test.ts, haizen-placement.service.test.ts, pallet-visualization-schedule-resolver.test.ts and pallet-visualization-display-fields.test.ts. Run from apps/api using vitest run with --fileParallelism=false. For real PostgreSQL use scripts/test/work-instructions-validation.sh with env -i, CI=true, temporary storage, PI5_SCHEDULER_LEADER_ENABLED=0 and no external credentials. Apply existing migrations only to the wrapper's unique database. Run the snapshot contract tests, mobile route tests selected by 'register-order-placement creates|haizen-scans records', and pallet-command-concurrency.integration.test.ts in sequence.

## Validation and Acceptance

Baseline consumer expectations must pass unchanged after the move. Real PostgreSQL fixtures verify typed snapshot values, missing rows, nulls, supplement scope and date/quantity handling. Existing registration integrations must pass. Lint changed TypeScript; run API tsc with --noEmit -p tsconfig.build.json and targeted new-test type checking. Scoped ESLint guards reject direct csvDashboardRow access in the three migrated consumers and reverse dependencies from the new owner. The ordinary local validation budget is 20 minutes; stop on differences/failures, investigate only this scope, and do not weaken expectations or guards. Cleanup must report TEMP_RESOURCE_REMAINING=0.

## Idempotence and Recovery

No production connection or deployment is included. Prior uncommitted work is preserved. Local copies in the task's work/snapshot-boundary/before directory contain the first-stage delta and the original display helper. To undo this follow-on, restore only these incremental edits, remove only its added files and documentation link, and recheck the prior lookup boundary; never reset the whole checkout. Future deployment requires the established exact-SHA/CI/artifact/approval procedure. Successful-release regression recovery is a validated revert release through the standard Pi5 API/Web Blue/Green route.

## Artifacts and Notes

Consumer baseline passed 34/34 in 0.642s; after the move the same expectations passed 34/34 in 0.606s. The exact read shape is asserted in placement and pallet fixtures; haizen asserts its selected ID and one findFirst call. PostgreSQL contract tests passed 9/9 in 0.588s; selected mobile registration routes passed 2/2 in 12.31s (25 unrelated cases not selected); the existing pallet command concurrency case passed 1/1 in 0.564s, including eight concurrent additions with distinct display orders. The wrapper completed with exit 0 and TEMP_RESOURCE_REMAINING=0, without container/volume/network inventory differences.

The first static run passed changed-file ESLint and the API build type check, then stopped at targeted test type checking: two existing and two added transaction mocks annotated the callback parameter as unknown, incompatible with Prisma.TransactionClient. Changed only callback inference and explicit partial-mock casts in the two affected test files. No production logic, fixture or assertion changed. The targeted test type check then passed, as did lint and the 23 tests in those two files (0.343s). Other successful tests were not repeated. Total validation remained within the ordinary 20-minute budget.

Scoped import probes passed 66 cases (including the two new owner files); direct-model-access probes passed 23 cases (dot/computed/optional access, destructuring, allowed business writes, allowed owner access and the explicitly deferred list reader). API tsc used --noEmit -p tsconfig.build.json. The separate temporary tsconfig included the four added/extended test files with explicit API node_modules/@types. All ten changed TypeScript files passed ESLint. git diff --check passed. The dimension helper body moved byte-for-byte, with its trailing separator blank line removed for the commit whitespace check; the prior lookup implementation remained byte-identical to the completed first milestone.

Commands executed from the worktree (using Node 24 / corepack pnpm 9.15.9):

    corepack pnpm --filter @raspi-system/api exec vitest run src/services/mobile-placement/__tests__/mobile-placement-order-placement.service.test.ts src/services/mobile-placement/__tests__/haizen-placement.service.test.ts src/services/pallet-visualization/__tests__/pallet-visualization-schedule-resolver.test.ts src/services/pallet-visualization/__tests__/pallet-visualization-display-fields.test.ts --fileParallelism=false
    corepack pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/production-schedule-snapshot.service.test.ts --fileParallelism=false
    corepack pnpm --filter @raspi-system/api exec vitest run src/routes/__tests__/mobile-placement.integration.test.ts -t 'register-order-placement creates|haizen-scans records' --fileParallelism=false
    corepack pnpm --filter @raspi-system/api exec vitest run src/services/pallet-visualization/__tests__/pallet-command-concurrency.integration.test.ts --fileParallelism=false

The last three commands ran sequentially within scripts/test/work-instructions-validation.sh after prisma migrate deploy on its disposable database. env -i excluded inherited credentials; the wrapper set DATABASE_URL to its dynamically allocated loopback port and all file storage to a temporary root. SIGNAGE_RENDER_DIR was inside that root and PI5_SCHEDULER_LEADER_ENABLED=0. The route harness reported unavailable local Chromium; these selected API cases do not use rendering, and no browser-dependent feature is claimed as validated.

Original Pi checkout remained clean at a71968c; DGX remained at 5b389d0 with its two pre-existing character-chat files modified and untouched. No commit, push, PR, merge or production access/deployment occurred. Separate follow-on and cumulative review patches accompany the user-facing report; the initial milestone report/patch remain unchanged.

## Interfaces and Dependencies

findProductionSchedulePlacementSnapshot(rowId) returns a nullable ProductionSchedulePlacementSnapshot with rowId, manufacturingOrderNo, seiban, partCode and partName. The four values are JsonValue. findProductionSchedulePalletSnapshot(rowId) returns the same fields plus resourceCode: JsonValue, plannedQuantity: number|null, plannedStartDate: Date|null and outsideDimensionsDisplay: string|null. Only production schedule reads and translates CSV columns. Consumers own their existing event/projection JSON keys and pallet date formatting. Existing Prisma, errors, lookup selection and transactions remain unchanged; add no dependency, cache, facade, generic repository or feature flag.

Revision note (2026-09-22): bounded continuation after the user requested resumption; previous local milestone remains preserved.

Revision note (2026-09-22): completed local migration and verification; documented the test-mock type correction, exact validation results, compatibility exception, cleanup and deferred read policies.

## Pallet list continuation (2026-09-22)

This continuation starts from fetched origin/main d435175ced8ce4a53d3b3fcf02d351f8642de55f in branch feat/production-schedule-pallet-list-boundary. The preceding registration work is historical and was integrated in PR #1466. The current bounded change moves only the batch CSV fallback read in pallet-visualization-query.service.ts into the existing production-schedule snapshot owner. Preserve board/machine/summary responses, sorting, persisted-snapshot precedence per field, zero, missing rows, errors, exact projection and zero-or-one batch read. No schema, migration, HTTP, rendering or dependency changes.

The list deliberately has no dashboard predicate on either rows or supplements. Do not reuse the dashboard-filtered registration reader. Add listProductionSchedulePalletDisplaySnapshots(rowIds: string[]) returning rowId, plannedQuantity, plannedStartDate and outsideDimensionsDisplay; an empty input performs no query. CSV conversion belongs to production schedule; date formatting and saved-snapshot precedence remain in the pallet consumer. No generic rowData crosses this boundary.

### Progress

- [x] Audited existing worktrees and created a clean worktree with the standard lifecycle CLI; original Pi and DGX work were preserved.
- [x] Before production edits, real-PostgreSQL consumer characterization passed 13/13; Vitest 1.05s, test bodies 165ms.
- [x] Moved the batch reader and CSV conversion; switched the consumer and extended the scoped ESLint guard. Existing dimension compatibility exports remain.
- [x] Unchanged consumer cases 13/13, owner contract cases 11/11 and display helper cases 5/5 passed; 29 total in 0.837s. Changed-file lint, API/test types and 32 dependency probes passed. Both disposable runs ended with TEMP_RESOURCE_REMAINING=0 and no Docker inventory differences.

### Validation and recovery

Use Node 24 and corepack pnpm 9.15.9. Run the new pallet-visualization-query.service.test.ts before and after extraction in the disposable scripts/test/work-instructions-validation.sh environment, with env -i, CI=true, PI5_SCHEDULER_LEADER_ENABLED=0 and existing migrations applied only to the unique loopback database. Preserve its fixture and assertion file unchanged after the baseline. Run the existing production-schedule-snapshot.service.test.ts and pallet display helper tests at the final boundary. Add only focused new-reader tests for empty input and its semantic projection. Lint changed TypeScript, run tsc --noEmit -p tsconfig.build.json, type-check new test files, and prove the new guard rejects direct CSV access while the owner is allowed. The ordinary local validation budget is 20 minutes.

For local recovery, restore only this continuation's tracked edits and remove only its new test files; do not reset other worktrees. Keep compatibility dimension exports for remaining existing callers/tests; the production-schedule module owns them, and removal requires an independently verified consumer migration. Barcode/part-search/assembly reads and Pi-DGX contracts remain separate work. Production updates, if undertaken, require the same exact-SHA CI and canonical Pi5 deployment evidence as the preceding milestone.

Revision note: added the narrowly scoped pallet-list continuation and its pre-move characterization gate.

### Outcome and evidence

This continuation is complete as a reviewable local implementation. No commit, push, PR, merge or production connection/deployment was performed in this continuation. The board, single-machine and machine-summary consumers all use the production-schedule-owned batch projection. Consumer characterization is byte-identical to the pre-move file (SHA-256 3e59e22758b87368629dc73411e120b4be8a1cd45902c77b2f7c85e86aad5413). The existing single-row registration contracts still pass. No new dependency, migration, API change, ID change, compatibility layer or retry was introduced.

Decision: keep the list contract separate from registration. Its production supplement relation is unique by csvDashboardRowId, but the existing take:1 and lack of dashboard filtering are retained exactly. Display date formatting and per-field saved-snapshot preference remain in the consumer. Empty row IDs are still filtered and duplicates removed before the batch call. The shared public function also short-circuits empty input.

Commands from the worktree used Node 24 / corepack pnpm 9.15.9. The PostgreSQL commands ran through the disposable wrapper after prisma migrate deploy, with inherited external credentials excluded and the wrapper's loopback URL/temp paths asserted before executing:

    corepack pnpm --filter @raspi-system/api exec vitest run src/services/pallet-visualization/__tests__/pallet-visualization-query.service.test.ts --fileParallelism=false
    corepack pnpm --filter @raspi-system/api exec vitest run src/services/pallet-visualization/__tests__/pallet-visualization-query.service.test.ts src/services/production-schedule/__tests__/production-schedule-snapshot.service.test.ts src/services/pallet-visualization/__tests__/pallet-visualization-display-fields.test.ts --fileParallelism=false
    corepack pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json

ESLint covered the two production readers, pallet display helper and two changed/new test files. A temporary tsconfig checked both test files with the API typeRoots. Dependency probes covered dot/computed/optional/destructured CSV access in all four guarded consumers, allowed business writes and owner reads, and rejected reverse imports from the snapshot owner into part measurement, placement and pallet code. Local verification stayed within the ordinary 20-minute budget (commands completed in a few minutes); no failed validation or unrelated fixes occurred. The initial lifecycle audit needed the existing Homebrew gh directory added to PATH, after which audit and start succeeded.

Original Pi checkout remained clean at a71968c; DGX retained its two pre-existing character-chat changes at 5b389d0. The new branch/worktree contains only the seven intended changed/new files and remains available for review. Production behavior was not manually exercised; the real-DB assertions are local compatibility evidence, not a new deployment claim.

Revision note: completed the pallet-list extraction and recorded unchanged baseline, final validation, remaining compatibility exports, deferred work and local recovery scope.
