# Add planning-board due scopes

This ExecPlan is a living document. It follows `.agent/PLANS.md` and records the additive API and storage work for planning-board due dates. It does not change the existing leaderboard due-management write path.

## Purpose / Big Picture

The planning board needs a left-pane due-date editor whose changes are isolated to one planning-board site. After this work, a client can read the original and planning-effective due detail for a seiban, then save a seiban or surface-processing due date without mutating CSV rows or the existing leaderboard settings. A stale client receives HTTP 409 and no partial writes; inherited split items follow their parent while direct split dates remain independent.

## Progress

- [x] (2026-09-10) Audited existing due-management target selection, processing fallback, planning overrides, split projection, and API registration.
- [x] (2026-09-10) Added the dedicated Prisma model and migration for planning due scopes, including retained null clear rows and versions.
- [x] (2026-09-10) Added shared GET/PUT contracts and planning-board due-detail/due-scope routes.
- [x] (2026-09-10) Added transaction conflict checks, source/scope fingerprints, parent-row locks, processing fallback, and inherited split rank handling. The fingerprint includes source rows/data, split state, original processing due, scope versions, and target override versions.
- [x] (2026-09-10) Corrected projection semantics so `originalDueDate` remains the source split/row due while only `effectiveDueDate` inherits the parent planning override; split item revisions include the parent override version and effective value.
- [x] (2026-09-10) Removed the redundant boardRevision request field. The board version and update timestamp remain inside `scopeRevision`; the shared API contract now uses only sourceGenerationToken and scopeRevision for conflict checks.
- [x] (2026-09-10) Expanded scopeRevision metadata to include row-note/supplement/completion state, original processing/seiban due versions, and part-processing mappings.
- [x] (2026-09-10) Reused the existing due-management target resolver, location-scope detail path, and shared detail presentation helper.
- [x] (2026-09-10) Added nullable `dueDateCleared` state to planning overrides. Processing clear can now represent CSV planned-end fallback without changing original row notes; generic restore and parent/split projection use the same state-aware resolver.
- [x] (2026-09-10) Focused projection/service/display tests pass: 4 files, 26 tests; shared-types and API builds plus focused lint pass. The final API build/lint rerun also passes after the snapshot-order, split-fallback, stable-split-fingerprint, and CSV-fallback-state fixes.
- [x] (2026-09-10) Dedicated local database integration completed with 7/7 tests passing against `planning_due_scope_20260910_04` on the isolated pgvector PostgreSQL instance at `localhost:55432`; migration 174 was applied, original source tables remained unchanged, and the test database was cleaned up.
- [x] (2026-09-10) Independent UI target validation reports 22 passing tests; API focused validation reports 26 passing tests; shared-types/API builds and changed-file lint pass.
- [ ] Have the parent review the uncommitted diff and the dedicated database results; do not commit in this worktree.

## Surprises & Discoveries

- Existing due-management writes `ProductionScheduleRowNote` for all winner rows and never writes `ProductionScheduleOrderSplit.dueDate`; therefore planning scope writes parent planning overrides and lets projection inheritance handle splits.
- A split override due is indistinguishable from a manually explicit split value unless the parent is used as the inherited source. The implementation leaves inherited split due unset and updates only its rank.
- The existing planning board `sourceRevision` describes board order, while due-scope conflict detection also needs the CSV generation, scope versions, target override versions, source rows, and split state. `scopeRevision` is a SHA-256 fingerprint of those values.

## Decision Log

- Decision: Store planning seiban and processing settings in one dedicated table with a stable `scopeKey`; retain a `dueDate=null` processing row for a standalone explicit clear, while a full seiban clear deletes processing scope rows and retains only the seiban clear row. Rationale: one composite key supports both scopes and distinguishes an explicit processing release from a full overlay reset.
- Decision: Preserve original due-management tables and row notes. Rationale: the planning board is an alternate assignment and must not alter the existing leaderboard behavior.
- Decision: Materialize parent planning due into the existing planning override and leave inherited split due unset. Rationale: the current projection already reads planning overrides, and parent inheritance avoids falsely turning a propagated value into a split-specific exception.
- Decision: Keep `dueDateCleared` nullable on planning overrides. Null preserves historical rows and resource-only updates, true means processing clear falls back to the supplement planned end, and false means an explicit generic restore returns to the original row due. Rationale: a nullable due date alone cannot distinguish an explicit CSV fallback from no due override.
- Decision: Lock every target parent row in the PUT transaction and map serialization/unique conflicts to 409. Rationale: target selection and rank reset must be atomic.

## Outcomes & Retrospective

Current outcome is an uncommitted implementation with shared-types/API builds, changed-file lint, 26 API focused tests, 22 UI tests, and 7/7 isolated database integration tests passing. The two additive migrations are `20260910100000_add_grinding_planning_due_scope` and `20260910140000_add_grinding_planning_due_clear_state`. Only the local dedicated database was used and it was cleaned up; parent diff review remains open. No production database, deployment, push, or commit is permitted for this worktree.

## Context and Orientation

`apps/api/prisma/schema.prisma` stores the planning state and per-item overrides. `apps/api/src/services/production-schedule/grinding-planning-board.service.ts` projects rows and writes generic item overrides. `grinding-planning-board-projection.ts` resolves parent and split effective values. The new `grinding-planning-board-due-scope.service.ts` reads existing due-management detail, builds the source/scope fingerprint, resolves processing overlays, and performs the transaction. `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts` registers the new GET and PUT routes. Shared request/response types live in `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`.

## Plan of Work

The migration creates `ProductionScheduleGrindingPlanningBoardDueScope` keyed by dashboard, site, seiban, and `scopeKey`. A seiban scope uses `scopeKey=seiban`; a processing scope uses `scopeKey=processing:<type>`. The planning service returns original detail and alternate detail, where processing settings overlay seiban settings and clear falls back to planning seiban or the original seiban/base date.

The PUT route validates the shared snapshot fields, locks target parents, rechecks the fingerprint, computes parent effective-date changes, updates only planning scope/override rows, clears ranks only for changed parent or inherited split values, and commits atomically. Direct split dates and explicit split due overrides are preserved. A seiban clear removes processing scope rows and restores parent planning overrides to null with `dueDateCleared=false` so future original-data changes remain visible; a standalone processing clear retains a null processing tombstone and sets `dueDateCleared=true` only when both planning and original seiban dates are absent, allowing the next planning-seiban set to release the original processing protection.

## Concrete Steps

Run from `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--planning-board-pane-layout`:

    pnpm --filter @raspi-system/api prisma:generate
    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/api exec eslint src/routes/kiosk/production-schedule/grinding-planning-board.ts src/services/production-schedule/grinding-planning-board-due-scope.service.ts src/services/production-schedule/grinding-planning-board.service.ts
    pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts src/services/production-schedule/__tests__/grinding-planning-board.service.test.ts src/services/production-schedule/__tests__/grinding-planning-board.service.unit.test.ts src/services/production-schedule/__tests__/due-management-effective-due-display.test.ts

The database integration test must use the repository's dedicated local test database only. It should apply the migration, create a winner parent with completed and hidden rows, original processing due, planning seiban/processing settings, direct and inherited splits, and item overrides. It must assert original records are unchanged, same due retains rank, changed due clears rank, processing clear falls back, stale fingerprints return 409 with no scope/override partial write, and a missing processing type returns 404.

The completed isolated run used `planning_due_scope_20260910_04` on the pgvector PostgreSQL instance at `127.0.0.1:55432`, applied migration 174, passed all 7 integration cases, verified original records were unchanged, and removed the test database afterward.

## Validation and Acceptance

`prisma generate`, shared-types build, API type build, and API lint must pass. The dedicated database test must exercise both seiban and processing PUTs, including empty due dates, then GET and compare `original` and `alternate`. Existing original due tables and row notes must be byte-for-byte unchanged. A stale `sourceGenerationToken` or `scopeRevision` must return 409 and leave all scope, override, and rank rows unchanged.

## Idempotence and Recovery

The migration is additive. Re-running generation/build/lint/tests is safe. If a dedicated test database is left dirty, reset only that test database using its existing repository cleanup command; never point the test command at production. Because no commit has been made, review or rollback uses the worktree diff and does not touch the main checkout.

## Artifacts and Notes

The final report must include the exact test commands, pass/fail counts, migration name, changed backend/shared files, and any unverified edge case. The parent agent owns commit, PR, and any deployment decision.

## Interfaces and Dependencies

The new shared request is `GrindingPlanningBoardDueScopeRequest` with `sourceGenerationToken`, `scopeRevision`, `scope`, and a YYYY-MM-DD-or-empty `dueDate`. GET returns `GrindingPlanningBoardDueScopeSnapshot` with `original`, `alternate`, `sourceGenerationToken`, and `scopeRevision`. The board version is included inside `scopeRevision`; the API uses Prisma transaction isolation, existing winner materialization resolution, existing due-management detail/resource-name resolution, and existing parent-row lock service.

## Change Note

2026-09-10: Created after implementation began because this feature adds a schema, API contract, transaction conflict protocol, and split inheritance behavior; the plan records the decisions and remaining dedicated database proof.
