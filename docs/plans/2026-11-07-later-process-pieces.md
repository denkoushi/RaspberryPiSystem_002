# Carry cutting pieces into later processes

This ExecPlan is maintained under `.agent/PLANS.md`. Its scope is local implementation and validation only; commit, push, PR, merge and deployment are not authorized.

## Purpose / Big Picture

Splitting a cutting row into quantities such as 1・2・2 also creates independently movable and completable pieces on existing later process rows of the same part. Only cutting can change the piece structure. Operators continue using the existing quantity and completion controls without new explanatory text.

## Progress

- [x] (2026-11-07 JST) Confirmed the requested worktree and clean initial working tree; inspected persistence, projection, quantity synchronization and UI boundaries.
- [x] (2026-11-07 JST) Added nullable sourcePieceId with a NO ACTION self reference, shared item contract, structural propagation and quantity synchronization.
- [x] (2026-11-07 JST) Added acceptance regression tests; API 90 tests and web 254 tests passed. Shared types build/lint, Prisma generate/validate, API/web type checks and package lint passed.
- [x] (2026-11-07 JST) Reviewed same-machine placement updates and verified the final service with focused lint and API type check. Final git diff --check passed; all 19 changed/new files belong to this task.
- [x] Review revision: verified on the approved disposable DB at localhost:55491/lpp; the piece suite passed all 103 tests, including 51 real-DB integration cases.
- [ ] integrationPending: commit, push, PR, merge and deployment are outside the authorized local implementation stage.

## Surprises & Discoveries

Projection, proportional required time and Progress aggregation already operate on each logical parent without requiring a cutting category. The logical key is the four raw CSV fields FSEIBAN/FHINCD/FSIGENCD/FKOJUN within the production dashboard. Existing root piece sets retain an empty version tombstone after full merge to reject ancient split requests.

The local worktree initially lacked dependencies. Offline installation with the existing lockfile and scripts disabled succeeded. Local PostgreSQL ports 5432 and 55432 did not respond; Docker access was denied. The standard test database start script stops/removes an existing container, so it is not used here.

## Decision Log

- Decision: Use ON DELETE NO ACTION and explicitly delete affected later pieces before replacing cutting pieces in the same transaction.
  Rationale: Preserve references while allowing dashboard and multi-set cascades in one statement; retain explicit child-first service deletion.
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

First add persistence and the optional source identifier. Discover current later winners with the same dashboard, seiban and part, compare process orders with the projection's shared comparator, and exclude completed or independently split rows. Every split/resplit/merge discovers eligible unsplit later winners, including rows imported after a previous split and parents whose cutting pieces predate this feature. Existing linked rows are rejected if their pieces, Progress or external completion are complete.

Capture the board before mutation at every affected site. Remove linked selected pieces before deleting cutting pieces, recreate them against the new source IDs, retain surviving IDs and position them to match cutting. Reuse replaceSiteItems for each logical parent. Reject direct later split/merge and reject cutting structural edits if any linked piece has manual completion evidence.

Quantity synchronization starts from cutting quantities, preserves each process's completion state, and uses planSessakuPieceQuantities to absorb the later row's own total at its last unfinished piece. Publish later Progress in the same transaction. Validate the API contract, proportional projection, completion and UI behavior with focused regression tests.

## Concrete Steps

From the repository root, install dependencies with `pnpm install --offline --frozen-lockfile --ignore-scripts`. Generate the Prisma client using `pnpm --filter @raspi-system/api exec prisma generate`. Build shared types with `pnpm --filter @raspi-system/shared-types build` before checking dependent packages.

Run `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json` and `pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json`. Run each changed package's lint script. Run focused Vitest files for sessaku-pieces, grinding-planning-board projection/load summary, quantity popup, completion table and page.

## Validation and Acceptance

The API integration fixture creates current and later rows for the same part. Three-piece splitting must preserve each site's later resource and position overrides. Nonadjacent merge and full merge must mirror cutting. Quantity increases/decreases and differing later totals must reconcile. Later completion must independently aggregate Progress, prohibit cutting structural edits and leave direct later split/merge rejected with specific error codes. UI tests must display N／M without an operable split/merge trigger and keep completion available.

Integration tests require TEST_DATABASE_URL and DATABASE_URL to identify the same dedicated disposable test database; the existing guard excludes borrow_return/postgres/template1. If no approved local test database is reachable, run the file to record its skips and report the verification limitation. Do not read .env files or change infrastructure. The review request explicitly authorizes resetting only the disposable localhost:55491/lpp database.

## Idempotence and Recovery

The migration is additive and is not applied to a shared or production database during this task. All structural mutations run inside the existing transaction, so failed validation and FK errors roll back together. Git status and diff checks protect the initially clean worktree. No history operations are part of recovery or completion.

## Interfaces and Dependencies

No new dependency or feature flag is added. sourcePieceId is nullable on the persisted piece and optional on the shared board item. Existing SESSAKU_PIECES_CREATE_ENABLED continues gating split and resplit; merge and completion retain their existing availability. New errors are LATER_PROCESS_PIECE_LOCKED and LATER_PROCESS_PIECE_COMPLETED, both HTTP 409.

## Outcomes & Retrospective

Initial implementation evidence (before review): API unit/route/projection/load tests passed (90); popup/completion/page tests passed (254). At that stage database persistence, FK execution, multi-connection serialization and transactional override propagation were unverified; the review validation below supersedes that limitation. The final integration invocation collected 38 tests and skipped them all. No migration, commit, push, history change or deployment was performed. The initial worktree was clean and the final changes are exclusively this task's work.

The later set is deleted on full merge, while the cutting set's existing version tombstone remains. Repeated quantity synchronization preserves additional later tail pieces and their completion evidence. Site placement snapshots are advanced after each replacement so a later parent sharing the cutting machine cannot recreate obsolete cutting overrides.

## Artifacts and Notes

The root historical EXEC_PLAN.md is unchanged. This plan is the task's single detailed record.

Revision 2026-11-07: Created after inspecting existing service boundaries; recorded deletion and shared lock expansion decisions.

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

## Review Revision (2026-11-07)

Structural propagation now reuses quantity reconciliation immediately and discovers newly eligible later winners on every structural mutation. Each later row uses its own total; a missing supplement falls back to the cutting supplement, then the cutting piece sum. Invalid totals preserve existing piece quantities and positions with a warning. A nullable sourcePieceSetId retains the cutting relationship when a later total of zero removes every piece, so either later-row or cutting-row synchronization can recreate sourcePieceId links. Source publication and supplement locking include these empty linked sets. Full merge still deletes later sets and keeps the original cutting tombstone.

Row completion now always acquires related logical locks, board state locks, then the row lock before reading pieces and Progress, including unchanged intents and ordinary rows. Real DB tests hold the first transaction at its board lock and start the competing transaction on a separate connection: completion-first leaves the completed later row unsplit; split-first completes all newly created later pieces. The barriers wrap transaction clients with a Proxy instead of modifying Prisma's shared methods.

Cutting shrink that would reduce any source below its linked completed quantity retains cutting quantities with COMPLETED_QUANTITY_EXCEEDS_PLAN. sourcePieceId and sourcePieceSetId use NO ACTION references, verified by deleting a dashboard and deleting all its sets in one statement. The existing unreleased migration was edited; no new migration was added. affectedItemIds explicitly documents that its IDs precede mutation and clear selection.

Validation: the approved DB reset passed using Prisma 7's `migrate reset --force` (this version rejects `--skip-seed` and does not automatically seed). Initial reset attempts failed on that unsupported option and Prisma's AI consent guard; the guard was satisfied with the user's existing explicit disposable-DB authorization. The first piece test invocation failed because the new column had not yet been applied. The next run exposed the test barrier's mutation of Prisma methods and an incorrect tail-count expectation; the barrier was fixed, and the expectation now preserves the existing additional unfinished tail according to the quantity planner. The final requested piece command passed 103/103 (51 integration), with no skips; command/projection tests passed 30/30; related web tests passed 254/254. The web run emitted existing jsdom connection errors without failures. API and web type checks passed. Shared-types/API/web package lint passed; API lint was repeated after the final source-publication adjustment and passed. Final git diff --check passed. Validation took approximately 8 minutes including failed attempts and diagnosis, within the 45-minute DB-change budget. Final lifecycle audit retained feat/later-process-pieces at fc8db12e with only this task’s uncommitted changes; there was no initial WIP. No secret file, UI copy, CI or infrastructure was changed, and no commit, push, history operation or deployment was performed.

## Second Review Revision (2026-11-07)

- Quantity plans remove nonpositive unfinished pieces even on warning returns; persistence also filters nonpositive quantities through the existing removal path. A completed later quantity of 3 with an unfinished tail of 2 can import a total of 2 without aborting the transaction.
- Later quantity warnings reject cutting split/merge with HTTP 409 PIECE_QUANTITY_CONFLICT. Cutting shrink retains quantities and warns if an invalid later plan would retain references to removed sources. The completed-later guard applies only when the corresponding cutting quantity decreases, so cutting growth from [1,2,2] to [1,2,3] remains allowed under a completed later tail of 4.
- Structural propagation consolidates unfinished pieces sharing a source before copying the cutting structure; the final unfinished piece absorbs the later plan difference. Completed evidence remains intact. Linked sets without a live later winner are not recreated on split and are deleted on full merge. An empty linked set retains its first cutting owner.
- Source synchronization now locks same-part row logical keys before initial set creation is possible, then rereads sets. Every participant obtains the same sorted key group even before any set exists. Supplement import no longer relies on an unlocked global precheck for existing pieces.
- CSV "0" normalizes to plannedQuantity=null and piecePlannedQuantity=0. Both create and update imports retain zero only when the same seiban/part already has a set. Before first split, ordinary rows keep their existing planned quantity (or null on create); a subsequent import after splitting applies zero and can empty the linked set. CSV "bad" and "-1" retain the existing null normalization and cutting-plan fallback.
- Ordinary completion avoids the dashboard ranking lookup and takes board locks only when related active sets exist after logical locking; row locking remains after board locking. Unsupported manufacturing-order/part keys lock only themselves and do not read related rows or sets. These rules supersede the previous revision's unconditional board-lock description.
- Progress completion on an empty linked set survives quantity synchronization; restored pieces inherit completion and timestamps, through both later and cutting quantity synchronization.
- sourcePieceSetId now has PSSPieceSet_source_idx. Both source FKs use NO ACTION, so later-process pieces/sets must be deleted before their cutting sources when deleting them in separate statements.

Validation evidence: disposable PostgreSQL localhost:55491/lpp was reset successfully with the edited unreleased migration. The requested piece/command invocation passed 136/136, including 67 real DB tests, with no skips (10.74 s). Supplement service and integration tests passed 22/22 (1.32 s). API and web type checks and shared-types/API/web package lint passed. Related web tests passed 254/254 (44.21 s), emitting the existing jsdom connection-error and baseline-browser-mapping messages without failures. The final integration-file ESLint check also passed after adding the two cutting-order tests. The initial focused unit invocation failed four expectations: ordinary completion no longer takes board locks, and the supported-key check initially inspected extra set fields; these were corrected before the successful suite. Concurrent first split/ordinary completion, supplement import/first split, and later-piece completion/cutting resplit were tested in both fixed orders using transaction-client proxies and separate connections. Both orders of splitting two cutting rows preserve a single later owner: an already linked cutting row rejects a direct split, and a separate cutting set cannot take the existing later set (including an empty set). Final git diff --check passed; validation remained within the 45-minute DB-change budget (approximately 10 minutes of work including diagnosis). The worktree was clean at entry; all current changes belong to this request. No secret file, UI text, CI or infrastructure was changed; no commit, push, history operation or deployment was performed.

## Third Review Revision (2026-11-07)

- Source publication snapshots manual Progress for empty linked sets and publishes it to the replacement winner in the same transaction, independently of ProductNo changes. The restoration regression now replaces the winner before restoring quantities through either later-row or cutting-row synchronization, and verifies publication visibility on a separate connection.
- CSV Progress sync processes up to 100 candidates per transaction. It acquires the sorted related logical locks before batch-reading current CSV rows, sets, Progress and CSV timestamps; changed/missing row keys are skipped. Fixed-order, two-connection tests cover CSV-first and split-first completion races; a 250-row test verifies three transactions and batch reads.
- Quantity sources report whether a winner exists. Orphaned later sets are skipped during quantity reconciliation; the orphan regression now also runs cutting quantity synchronization and cutting piece completion without recreating later pieces.
- Linked later pieces fall back to the set's resolved plannedQuantity when their supplement total is null. Projection tests verify the denominator, proportional minutes, known load and incomplete load total.
- Supplement CSV zero is retained only for rows whose seiban/part already has a set. Ordinary rows preserve the existing quantity, including 5; zero received before the first split is applied on the next import after splitting. The service regression returns logical keys from the lock mock and checks both ordinary and same-part-set cases.
- Related-key lookup uses parameterized SQL with the same COALESCE(rowData->>'FSEIBAN', '') and FHINCD expressions as the existing logical-key index, comparing text values. EXPLAIN on localhost:55491/lpp with 5,000 synthetic rows inside a rolled-back transaction chose `Index Scan using csv_dashboard_row_prod_schedule_logical_key_idx`, with both expressions in Index Cond, without planner overrides. The empty/small fixture alone preferred a sequential scan or the dashboard-only index.

Validation: the requested full `production-schedule` command with both database URLs pointing to localhost:55491/lpp finished in 42.91 s: 1,175 passed, one known failure, 16 existing skips (154 files). The only failure is the explicitly excluded `keeps an override on a same-logical-key winner and ignores legacy record changes` assertion at grinding-planning-board.integration.test.ts:1114; it was left unchanged. Existing database opt-in conditions skip seven D-schedule apply cases, two board-due SQL cases and seven due-scope integration cases on the specified lpp database; their guards were not changed. All 69 piece DB integration cases passed. API (`tsc --noEmit -p tsconfig.build.json`) and web (`tsc --noEmit -p tsconfig.json`) type checks passed. API, web and shared-types package lint passed; the command-service test file also passed focused lint after its SQL call-order expectations were updated.

The initial focused run exposed three test expectation/edit errors, corrected before the successful 37-test rerun. The first full run exposed three command-service assertions that still counted/indexed the old JSON-path lookup; the related 14-test command suite passed after updating those expectations, and the final full run had only the known excluded failure. Validation and diagnosis took approximately five minutes, within the 45-minute DB-change budget. File snapshots taken before editing were used for final scope/whitespace checks because the user prohibited git operations. This revision edited 14 existing source/test/plan files and preserved other file contents; it ran no git operation, migration/reset, release or deployment and read no secret file. No UI copy was added.

## Fourth Review Revision (2026-11-07)

- Resolved the nine merge-conflicted files in the working tree without changing the index. Main's audited operation wrappers, quantity redistribution, submit validation, current-bar lookup and completion blocking remain; later-process propagation and quantity-only controls are retained on top.
- Before deleting cutting pieces, orphaned later sets now delete unfinished references and detach completed references by clearing sourcePieceId. Their completed quantities and timestamps remain intact.
- External completion protects existing later pieces only; it creates no new quantity, including for plans of two and zero.
- CSV completion expands lock groups only for parts with a set. Logical locks are deduplicated, sorted and acquired in one statement with WITH ORDINALITY / ORDER BY. Mail-critical locking precedes logical locking. A failed 100-row batch logs only its count and first five row IDs and allows later batches and the caller's import finalization to continue.
- Supplement zero quantities apply only to parts with nonempty sets or sourcePieceSetId; empty cutting tombstones preserve the ordinary import behavior.
- Manual completion is inherited across winner changes even when ProductNo (注番) changes, because completion belongs to the logical key.
- Terminal split/merge/complete/uncomplete audit snapshots and result IDs include changed later sets and pieces. Supplement and CSV imports collect snapshots in the transaction, then use runSessakuPieceOperation to write one propagate audit per committed part, combining batches and excluding rolled-back changes. Imports have no device actor; supplement imports use siteKey `__shared__`, and CSV imports use the supplied location or that fallback. No audit table or migration was added.

Validation: API `tsc --noEmit -p tsconfig.build.json` and web `tsc --noEmit` passed. Shared-types, API and web package lint passed; the three tests edited after the API lint run also passed focused lint. The complete production-schedule suite finished in 84.68 seconds: 1,211 passed, 16 existing skips and only the known snapshotId failure in `keeps an override on a same-logical-key winner and ignores legacy record changes` (155 files). All 81 piece database integration cases passed. The related web suite passed 676 tests across 35 files in 58.33 seconds. Nine conflicted files have no markers, and `git diff --check` passed.

The supplied disposable database received main's existing audit migration using migrate deploy; Prisma Client was generated without changing the schema. The first run used an outdated client and its cleanup stopped; only fixtures created by that failed run were removed before the final suite. Those leftover future-dated Progress rows also exposed an existing canonical-cache generation limitation, which was not changed. Test runs disabled dotenv loading and used an empty Vite env directory to avoid reading secret files. No index, commit, push, merge completion, CI, infrastructure, UI copy or deployment change was performed; Git still reports the nine unmerged index entries as requested.

## Fifth Review Revision (2026-11-07)

- CSV Progress sync now retries a failed batch one row per transaction, processes all remaining batches, writes audits for committed propagation through the existing `piece-audit.ts` helper, then throws if any row still failed. This restores main's FAILED ingest outcome and skips successful completion bookkeeping and loser cleanup; failed runs still record their failure time. On `origin/main` (`5f063e7c`), rows are already saved before Progress sync and unchanged timestamps are excluded from the next diff, even for FAILED runs. Reimporting the identical CSV therefore does not guarantee recovery on main either; this revision minimizes failures and never reports a residual sync failure as success, without changing the diff contract.
- Mail-critical locking protects piece quantity/Progress aggregation against mail-derived external completion publication. Ordinary-row-only batches do not take it. If a first split appears while waiting for logical locks, the transaction rolls back and restarts with critical before logical, board and row locks.
- Both quantity-sync directions retain completed pieces with NULL sourcePieceId and count their quantities, including COMPLETED_QUANTITY_EXCEEDS_PLAN warnings. Hidden sets without a winner no longer block structural edits merely because a piece is completed: referenced unfinished pieces are deleted, completed ones are detached, and sourcePieceSetId is cleared once every source reference is gone. Full merge retains its existing later-set deletion behavior.
- Only structural operations discover unsplit later winners. Completion/cancellation affectedItemIds and audits contain actual piece sets, excluding unrelated unsplit third-process rows.
- Added regression cases for batch timeout/retry/failure, ingest FAILED bookkeeping, winner return in both quantity directions, hidden completed pieces on resplit/merge, third-process responses/audits, raw-zero placement preservation, and supplement logical/board locking concurrent with cutting critical/logical/board locking.
- The retained cutting warning name INVALID_PLANNED_QUANTITY is unchanged as requested; its behavior already follows the specification. No migration, UI text, CI, infrastructure, secret-file access, deployment, staging or Git history mutation is part of this revision.

Validation: API/web type checks and package lint passed; the final integration-file edit also passed focused ESLint. The requested API command (`vitest run src/services/production-schedule src/services/csv-dashboard src/services/imports`) on the approved localhost:55491/lpp database completed in 142.57 seconds: 1,637 passed, 16 existing skips, and only the explicitly excluded snapshotId failure in `grinding-planning-board.integration.test.ts:1114`. All 91 piece DB integration cases, 15 CSV Progress cases and 6 ingest-boundary cases passed. Web `grindingPlanningBoard` tests passed 476/476 across 34 files (12.71 seconds). The initial focused run had three new-test expectation failures; they were corrected to check the existing ordinary-zero rule and the current set's legitimate audit snapshot. Validation took approximately six minutes, within budget.

Raw zero follows the existing Second/Third/Fourth Review decisions: ordinary rows before their first split preserve their previous quantity; once cutting pieces exist, importing raw "0" and then resplitting keeps the later set empty and linked, with its parent placement unchanged. No initial-split zero policy change was made. The worktree began clean, and its seven modified files are exclusively this revision; final `git diff --check` passed.
