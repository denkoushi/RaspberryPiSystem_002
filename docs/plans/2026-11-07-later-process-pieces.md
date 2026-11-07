# Carry cutting pieces into later processes

This ExecPlan is maintained under `.agent/PLANS.md`. Its scope is local implementation and validation only; commit, push, PR, merge and deployment are not authorized.

## Purpose / Big Picture

Splitting a cutting row into quantities such as 1・2・2 also creates independently movable and completable pieces on existing later process rows of the same part. Only cutting can change the piece structure. Operators continue using the existing quantity and completion controls without new explanatory text.

## Progress

- [x] (2026-11-07 JST) Confirmed the requested worktree and clean initial working tree; inspected persistence, projection, quantity synchronization and UI boundaries.
- [x] (2026-11-07 JST) Added nullable sourcePieceId with a restrictive self reference, shared item contract, structural propagation and quantity synchronization.
- [x] (2026-11-07 JST) Added acceptance regression tests; API 90 tests and web 254 tests passed. Shared types build/lint, Prisma generate/validate, API/web type checks and package lint passed.
- [x] (2026-11-07 JST) Reviewed same-machine placement updates and verified the final service with focused lint and API type check. Final git diff --check passed; all 19 changed/new files belong to this task.
- [ ] Dedicated-DB verification remains unavailable: final integration file collected 38 tests and skipped all 38. No database migration was executed.
- [ ] integrationPending: commit, push, PR, merge and deployment are outside the authorized local implementation stage.

## Surprises & Discoveries

Projection, proportional required time and Progress aggregation already operate on each logical parent without requiring a cutting category. The logical key is the four raw CSV fields FSEIBAN/FHINCD/FSIGENCD/FKOJUN within the production dashboard. Existing root piece sets retain an empty version tombstone after full merge to reject ancient split requests.

The local worktree initially lacked dependencies. Offline installation with the existing lockfile and scripts disabled succeeded. Local PostgreSQL ports 5432 and 55432 did not respond; Docker access was denied. The standard test database start script stops/removes an existing container, so it is not used here.

## Decision Log

- Decision: Use ON DELETE RESTRICT and explicitly delete affected later pieces before replacing cutting pieces in the same transaction.
  Rationale: A database deletion must never silently turn a later piece into a cutting piece.
  Date/Author: 2026-11-07 / Codex.
- Decision: Expand existing same-part keys inside acquireSessakuPieceLogicalLocks before sorting, and include winner row keys before initial splitting.
  Rationale: Completion, CSV progress and supplement synchronization also enter this lock boundary; adding locks after a single-parent lock would allow reversed lock ordering.
  Date/Author: 2026-11-07 / Codex.
- Decision: Preserve the existing cutting tombstone, but delete the empty later piece set on full merge.
  Rationale: This preserves stale cutting-request protection and returns later processes to ordinary rows as requested.
  Date/Author: 2026-11-07 / Codex.
- Decision: Keep completed quantity evidence; if cutting shrink would delete a referenced completed later piece, retain the cutting structure with the existing COMPLETED_QUANTITY_EXCEEDS_PLAN warning.
  Rationale: Quantity imports must not silently discard completed work or break the source FK.
  Date/Author: 2026-11-07 / Codex.

## Context and Orientation

`apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts` performs structural mutations and inherits each site's position and resource overrides. `piece-key.ts` owns logical locks and winner lookup. `piece-quantity.ts` plans cutting quantities and applies the later row's own planned quantity at its unfinished tail. `piece-sync.ts` invokes reconciliation during imports. `piece-completion.ts` derives a row's Progress from its own pieces.

`apps/api/prisma/schema.prisma` and migration `20261107120000_add_later_process_piece_source` add the self reference. `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts` exposes sourcePieceId, which the API projection forwards. `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx` suppresses structural controls for linked pieces. The mutation response includes affectedItemIds for old cutting/later parents and pieces, so the page clears their selection even across hidden categories and concurrent refreshes.

## Plan of Work

First add persistence and the optional source identifier. Discover current later winners with the same dashboard, seiban and part, compare process orders with the projection's shared comparator, and exclude completed or already split rows on first split. Later structural edits follow only existing links, leaving newly imported rows unsplit.

Capture the board before mutation at every affected site. Remove linked selected pieces before deleting cutting pieces, recreate them against the new source IDs, retain surviving IDs and position them to match cutting. Reuse replaceSiteItems for each logical parent. Reject direct later split/merge and reject cutting structural edits if any linked piece has manual completion evidence.

Quantity synchronization starts from cutting quantities, preserves each process's completion state, and uses planSessakuPieceQuantities to absorb the later row's own total at its last unfinished piece. Publish later Progress in the same transaction. Validate the API contract, proportional projection, completion and UI behavior with focused regression tests.

## Concrete Steps

From the repository root, install dependencies with `pnpm install --offline --frozen-lockfile --ignore-scripts`. Generate the Prisma client using `pnpm --filter @raspi-system/api exec prisma generate`. Build shared types with `pnpm --filter @raspi-system/shared-types build` before checking dependent packages.

Run `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json` and `pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json`. Run each changed package's lint script. Run focused Vitest files for sessaku-pieces, grinding-planning-board projection/load summary, quantity popup, completion table and page.

## Validation and Acceptance

The API integration fixture creates current and later rows for the same part. Three-piece splitting must preserve each site's later resource and position overrides. Nonadjacent merge and full merge must mirror cutting. Quantity increases/decreases and differing later totals must reconcile. Later completion must independently aggregate Progress, prohibit cutting structural edits and leave direct later split/merge rejected with specific error codes. UI tests must display N／M without an operable split/merge trigger and keep completion available.

Integration tests require TEST_DATABASE_URL and DATABASE_URL to identify the same dedicated disposable test database; the existing guard excludes borrow_return/postgres/template1. If no approved local test database is reachable, run the file to record its skips and report the verification limitation. Do not read .env files, change infrastructure, or provision/reset an existing database.

## Idempotence and Recovery

The migration is additive and is not applied to a shared or production database during this task. All structural mutations run inside the existing transaction, so failed validation and FK errors roll back together. Git status and diff checks protect the initially clean worktree. No history operations are part of recovery or completion.

## Interfaces and Dependencies

No new dependency or feature flag is added. sourcePieceId is nullable on the persisted piece and optional on the shared board item. Existing SESSAKU_PIECES_CREATE_ENABLED continues gating split and resplit; merge and completion retain their existing availability. New errors are LATER_PROCESS_PIECE_LOCKED and LATER_PROCESS_PIECE_COMPLETED, both HTTP 409.

## Outcomes & Retrospective

Local implementation is complete. API unit/route/projection/load tests passed (90); popup/completion/page tests passed (254). Database persistence, FK execution, multi-connection serialization and transactional override propagation remain unverified on an actual database because the dedicated database is unavailable. The final integration invocation collected 38 tests and skipped them all. No migration, commit, push, history change or deployment was performed. The initial worktree was clean and the final changes are exclusively this task's work.

The later set is deleted on full merge, while the cutting set's existing version tombstone remains. Repeated quantity synchronization preserves additional later tail pieces and their completion evidence. Site placement snapshots are advanced after each replacement so a later parent sharing the cutting machine cannot recreate obsolete cutting overrides.

## Artifacts and Notes

The root historical EXEC_PLAN.md is unchanged. This plan is the task's single detailed record.

Revision 2026-11-07: Created after inspecting existing service boundaries; recorded restrictive deletion and shared lock expansion decisions.

Revision 2026-11-07: Added affectedItemIds to clear hidden-category selections, retained later tail completion evidence across repeated quantity reconciliation, and included orphaned linked sets in structural replacement.

## Final Validation Evidence

Commands ran from the repository root. The combined API test command took 5.24 seconds; the web command took 52.41 seconds. Package lint and type checks took several minutes in total; local validation remained within the 45-minute DB-change budget.

- `pnpm install --offline --frozen-lockfile --ignore-scripts`: passed, no lockfile change.
- `pnpm --filter @raspi-system/slip-match-core --filter @raspi-system/part-search-core --filter @raspi-system/shelf-layout-core --filter @raspi-system/kiosk-sop-core build`: passed; required workspace build outputs were initially absent.
- `pnpm --filter @raspi-system/shared-types build`: passed.
- `pnpm --filter @raspi-system/api exec prisma generate`: initially failed with EPERM updating the read-only home cache. Copied the existing public Prisma engine cache to `/private/tmp/later-process-prisma-cache/prisma/`; reran with `XDG_CACHE_HOME=/private/tmp/later-process-prisma-cache` and passed.
- `XDG_CACHE_HOME=/private/tmp/later-process-prisma-cache pnpm --filter @raspi-system/api exec prisma validate`: passed.
- `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json`: initial attempts failed because Prisma generation and dependent workspace builds were missing; after preparing them, passed. Repeated after the final service placement change and passed.
- `pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json`: passed.
- `pnpm --filter @raspi-system/shared-types --filter @raspi-system/api --filter @raspi-system/web lint`: shared-types/API passed; the first web check failed while files were being edited and also reported one excess page line. Kept the page within its existing cap, stopped edits during lint and reran `pnpm --filter @raspi-system/api --filter @raspi-system/web lint`; both passed. After the final API placement adjustment, focused ESLint of the service and integration file passed.
- `pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/sessaku-pieces src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts src/services/production-schedule/__tests__/grinding-planning-board-load-summary.test.ts src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts`: 90 passed, then-current 37 DB tests skipped.
- `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.test.tsx src/features/kiosk/grindingPlanningBoard/__tests__/PlanningBoardItemTable.completion.test.tsx src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx`: 254 passed. Existing browser mapping/jsdom connection messages were emitted without test failures.
- `pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`: final file collected 38 tests, all skipped without TEST_DATABASE_URL. Local ports 5432/55432 did not respond; Docker access was denied. The repository's start script stops/removes an existing container, and was not run. The installed native PostgreSQL 14 lacks the vector extension required by repository migrations, so no substitute database was provisioned.
- `git diff --check`: passed. No secret file was read. Deploy, Ansible, infrastructure and CI files are unchanged.

## Changed Files

- `apps/api/prisma/migrations/20261107120000_add_later_process_piece_source/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-projection.ts`
- `apps/api/src/services/production-schedule/process-order.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-key.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-quantity.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-key.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-quantity.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.test.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/__tests__/PlanningBoardItemTable.completion.test.tsx`
- `apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx`
- `apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx`
- `docs/INDEX.md`
- `docs/plans/2026-11-07-later-process-pieces.md`
- `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`

Revision 2026-11-07: Recorded final validation, failed prerequisites and recovery, explicit DB limitations, affected-selection contract and same-machine rank preservation.
