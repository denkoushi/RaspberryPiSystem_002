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

## Sixth Review Revision (2026-11-07)

- Full merge retains hidden later sets containing completed pieces, with sourcePieceSetId cleared; sets without completed evidence are still deleted.
- Quantity planning fills each cutting source's deficit with a corresponding unfinished later piece before absorbing process plan differences at the final unfinished piece. Cutting shrink protection also counts completed later pieces with NULL sourcePieceId.
- Hidden sets' warnings no longer block cutting structural edits; detaching their final source references clears quantityWarning as well.
- Full merge does not discover ordinary unsplit later rows, avoiding temporary sets, overrides, Progress writes and extra board version increments. Empty linked sets without existing Progress do not upsert an incomplete result.
- Regression tests cover completed/unfinished hidden sets, external completion followed by supplement shrink and winner deletion, both quantity update orders, detached completed quantities, untouched ordinary rows and absent Progress. Supplement lock scope and INVALID_PLANNED_QUANTITY remain unchanged as requested; the known snapshotId failure remains outside scope.

Validation: the focused quantity/integration run passed 143/143 in 18.68 seconds. The requested production-schedule/csv-dashboard/imports run on localhost:55491/lpp passed 1,651 tests, including all 102 piece DB integration cases, with 16 existing skips and only the explicitly excluded snapshotId assertion at grinding-planning-board.integration.test.ts:1114 (221.28 seconds). API/web type checks and package lint passed. Tests disabled dotenv loading and used an empty Vite env directory. Validation took approximately five minutes, within budget; final git diff --check passed. The worktree began clean, and all six changed files belong to this revision. No secret file was read; no staging, Git history operation, migration/reset, CI, infrastructure, UI text or deployment change was performed.


## Seventh Review Revision (2026-11-07)

- Resolved sessaku-pieces.service.ts in the working tree only. Main's shared projection reads, bulk INSERT / ON CONFLICT writes, requested quantities and timing remain; later-process propagation and related locks are retained. The override map now uses the bulk write payload so later replacements inherit the current placement without returned rows. Logical-key winner reads retain main's live, FSEIBAN-scoped CTE.
- Empty-to-empty later replacements skip lane replacement. Regression coverage places the zero-quantity later parent and cutting pieces on the same machine, verifies unique ranks and retains the parent's placement.
- Persisted later positions are assigned after quantity adjustment removes zero work, preserving existing tail IDs. Unit and DB regressions apply the same quantity twice and compare the complete plan/set, including version.
- After snapshots include the before snapshot's set IDs, retaining detached completed pieces in terminal and import audits. Winner-disappearance tests verify the retained evidence.
- P2003 is mapped to HTTP 409 / PIECE_REFERENCED. The existing P2002/P2034 mappings remain covered.
- Import removal does not increment board state version for either cutting or later pieces. Main's cutting removal has the same behavior; it is intentionally unchanged.
- Main's four-site performance and audit expectations now include later propagation, checking both affected machine lanes, source links, bulk-write counts and state version increments. Web's automatic merge retains count preservation, operation guards and later-piece restrictions.

Validation: API/web type checks and package lint passed; the final integration-test edit also passed focused ESLint. The final focused piece suite passed 190/190. The requested production-schedule/csv-dashboard/imports suite completed in 121.92 seconds: 1,677 passed, 16 existing skips, and only the explicitly excluded snapshotId assertion at grinding-planning-board.integration.test.ts:1114 failed (208 files). All 105 piece DB integration cases passed. The requested web suite passed 1,264/1,264 across 85 files in 70.97 seconds, including PlanningBoardPiecePopover and ProductionScheduleGrindingPlanningBoardPage. The four-site performance case measured split at 346.4 ms and merge at 253.9 ms in the full run.

The initial focused run exposed two tail-identity regressions in the first quantity-position fix and two main-only propagation expectations; these were corrected before the successful focused/full runs. Validation took approximately eight minutes, within the DB validation budget. Final git diff --check passed, HEAD remains d940ae68, and the only unmerged index path remains sessaku-pieces.service.ts. This revision changed ten existing source/test/plan files and preserved the pre-existing staged main merge changes.

Main's two existing migrations (audit request timing and outsource vendors) were applied to the supplied lpp test database using prisma migrate deploy, and Prisma Client was generated. No new migration or reset was used. Tests disable dotenv loading and use an empty Vite env directory. No staging, commit, push, merge completion/abort, CI, infrastructure, UI copy or deployment change was performed; existing merge entries are preserved.


## Eighth Review Revision (2026-11-07)

- With no cutting sources, later quantity planning retains NULL-source unfinished pieces as its baseline, preserving their IDs, positions and placement overrides on repeated synchronization. Returning sources still replace unfinished detached work; unit coverage verifies repeated plans remain identical in both cases.
- CSV ingestion treats empty linked sets as active piece sets for update and loser-cleanup publication. A database regression imports only the later row, changes the winner ID and deletes the old winner while retaining manual Progress completion.
- Added database regressions for repeated quantity synchronization after cutting [1,2] disappears and a completed quantity-2 later piece remains, and two later processes with linked versus ordinary external completion. Strengthened the existing cutting-resplit/later-piece-completion concurrency test in both lock orders with source/quantity/position/Progress consistency and raw database deadlock checks. Linked completion rejects and rolls back sets, overrides and board states; ordinary completed rows remain excluded.

Validation: API `tsc --noEmit -p tsconfig.build.json`, web `tsc --noEmit -p tsconfig.json` and both package lint commands passed. The requested API `vitest run src/services/production-schedule src/services/csv-dashboard src/services/imports` completed in 87.84 seconds: 1,684 passed, 16 existing skips and only the excluded snapshotId assertion at grinding-planning-board.integration.test.ts:1114 failed. After consolidating two redundant concurrency cases into the existing test and strengthening raw-error checks, the final quantity/integration run passed 152/152 (including all 109 DB cases) in 34.41 seconds; focused ESLint of the final integration file also passed. Web `vitest run src/features/kiosk/grindingPlanningBoard` passed 483/483 across 34 files in 10.38 seconds. Initial CSV test fixtures were corrected for ingestion's ProductNo/FSEIBAN lengths and the replacement row's zero supplement before the successful runs.

Validation used the supplied localhost:55491/lpp database, a dotenv-disabling Node preload and temporary Vite configs pointing envDir at an empty directory. Health/performance and the known snapshot failure were not changed. Validation stayed within the 45-minute budget. The worktree began clean; the five changed files belong solely to this revision, the index remains empty, and final git diff --check passed. Branch feat/later-process-pieces and HEAD 55283817 are unchanged. No secret file was read; no git add, commit, push, history mutation, migration/reset, CI, infrastructure, UI text or deployment change was performed.


## Known Limitations

- 製番が `********` の分割要求は、同じ品番の行をロックしてから `UNSUPPORTED_PIECE_PARENT` を返す。性能・競合への影響のみで、データは壊れない。
- 片が0個になったリンク済み後工程 set の行には CSV の完了フラグが反映されない。片の完了を正とするため、キオスクの完了ボタンで完了する。

- 後工程の勝者行が消えている間に切削を分け直す／まとめると、勝者が戻ってもその後工程 set は切削の片と対応づかないことがある（数量の合計は保たれる）。
- 完了済みで空・未リンクの切削 set B は取り込まれず、B に付いた後工程 C もたどらないため、A を分けても C に片ができない。B の完了を取り消して A を分け直せば戻る。
- 切削の勝者行が CSV から消えると、その set に付いた後工程（取り込んだ切削行を含む）は行が戻るまで固定される。
- 勝者が消えて外された後工程 set に完了片が残っていると、勝者が戻った後の補助 CSV 同期で、切削側の処理として新しい未リンクの片ができることがある。指示数が無ければ `INVALID_PLANNED_QUANTITY` になる。
- 未リンクの未完了片の合計が後工程の指示数以上なら、数量調整で未完了のリンク片がすべて0になり、切削との片の対応を失う。15回目の ID・数量保持の規則による既知の制約として維持する。`piece-quantity.test.ts` の指示数1・0の境界と16回目の未リンク片だけの全結合で確認。自動でリンクを付け替えると作業の由来を変えるため行わない。
- 構造変更で作り直した片は、サイトごとに削除対象のうち板で最初に出る片の配置をまとめて引き継ぐ。数量0で消える末尾片の配置を新片が引き継ぐ場合もある。`replaceSiteItems` の既存規則を確認し、既知の制約として維持する。元片ごとの配置対応へ変えるには別の継承規則が必要になる。
- 親行完了の set 読み取りは board lock より前に行う。先に取得する関連論理ロックが片・setの変更を直列化しており、既存の分割／数量同期／配置更新も同じ論理ロックを使うため、通常経路の競合は保護される。読み取り順の既知の制約として記録し、今回は再読み取りを追加しない。

## Ninth Review Revision (2026-11-07)

- 補助 CSV の作成・更新とも、自身の set が空で sourcePieceSetId を持たない切削行を、関連 set による raw "0" 保存の特例から除外。両 set が空の状態での作成・更新と、その後の [2,3] 分割を DB 回帰テストで確認。
- API 投影と共有型に set 単位の isLaterProcess を追加。参照の外れた後工程片と片0個のリンク済み切削行では「分ける」「まとめる」を隠す。完了操作・UI 文言は変更しない。投影と web の回帰テストを追加。

検証: 指定の API `vitest run src/services/production-schedule src/services/csv-dashboard src/services/imports` は 1,686 成功・16 skip・既知の snapshotId 失敗1件のみ（122.63秒）。片の DB 統合テスト111件はすべて成功。web `vitest run src/features/kiosk/grindingPlanningBoard` は34ファイル・487件成功（17.35秒）。API/web の指定型チェックと両 package の lint、共有型の build/lint は成功。最後に変更した完了ボタンのテストも個別 lint 成功。最初の web 全体テスト起動は root で vitest が見つからず未開始となり、apps/web から正しく実行した。

指定の localhost:55491/lpp と、dotenv を無効化する preload・空の envDir を使った一時 Vite 設定で検証。検証・確認は約5分で予算内。既知の snapshotId・health・performance は修正していない。開始時に既存 WIP はなく、変更9ファイルはこの修正のみ。最終 git diff --check 成功、index は空、branch feat/later-process-pieces・HEAD c638e6c4 は維持。秘密ファイルの読み取り、git add、commit、push、履歴操作、migration/reset、CI・infrastructure・UI 文言の変更、デプロイは未実施。


## main #2613 の取り込み (2026-11-07)

- 加工機列への絞り込み、段階別計測、一括書き込みを保持し、後工程の伝播・監査・メール critical → 論理キー → board → 行のロック順を維持。
- readLaneScope に、各 site の後工程の親／既存片がいる列も追加。その列へ override で流入する別製番の親／片も読み、projection・before.overrides・rank の欠落を防ぐ。
- 4サイト・約7,500行で、切削と異なる後工程列、サイト別配置、流入行を含め、分割・再分割・部分結合・全結合の永続化結果（sourcePieceId、順位、加工機、override 等）を全列読み取りの従来方式と比較。main の性能・null列テストと後工程の既存テストを両立。
- web は main の分割画面テストと set 単位の isLaterProcess による操作制限テストを保持。後工程の選択解除テスト2件は #2611 のボタン名「2つに分ける」に合わせた。

検証: 指定 API 範囲は1,699成功・16 skip・既知の snapshotId 失敗1件のみ（121.63秒）。片の DB 統合113件は全成功。各操作の読み取りは7,478行から108行になり、従来方式と永続化結果が一致。指定 web 範囲は1,199件全成功（53.60秒）。API/web 型チェック・package lint・最終編集テストの個別 lint も成功。

指定 DB の migrate deploy は未適用なし。dotenv 無効化・空の envDir で秘密ファイルを読まず検証し、一時設定を削除。検証は約5分。マーカー0件・git diff --check 成功。既存 staged 差分を保護し、編集は6ファイル。HEAD 1d05b1a2・branch・UU 3件を維持。git add・commit・push・merge 完了／中止・新規 migration／reset・CI・infrastructure・UI 文言・デプロイの変更は未実施。

## Tenth Review Revision (2026-11-07)

- 空の独立した切削 set を取り込むとき、その set を参照する後工程も再帰的に対象へ含め、数量同期・削除の前に分割元へ直接付け替える。完了保護・数量同期・全結合を同じ対象へ適用する。既存の関連論理キー収集は勝者不在の set も含むため、メール critical → 論理キー → board state → 行のロック順は変更しない。
- B 分割 → 補助 CSV の B・C 指示数0 → A 分割 → 全結合を実 DB で検証する回帰テスト2件を追加。C の完了保護とロールバック、空のままの全結合、数量復帰後の B・C と A の sourcePieceId・数量・順序の一致、親行への復帰を確認する。
- 画面の mergeItems に isCutting 条件を追加し、非切削の兄弟片を選択しても「まとめる」を表示しないテストを追加。UI 文言は変更しない。

検証: API `tsc --noEmit -p tsconfig.build.json`、web `tsc --noEmit -p tsconfig.json` と両 package の lint は成功。API の sessaku-pieces 配下と route テストは219件成功（実 DB 統合115件を含む、109.15秒）。web `vitest run src/features/kiosk/grindingPlanningBoard` は34ファイル・494件成功（16.20秒）。追加テストの修正前失敗と修正後成功も確認。

指定 DB localhost:55491/lpp、dotenv 無効化・空の envDir で検証し、一時設定は削除。検証は約4分、最終 git diff --check 成功。開始時の既存 WIP はなく、変更5ファイルは本修正のみ。branch feat/later-process-pieces・HEAD 60585c1c を維持。秘密ファイルの読み取り、git の変更操作、migration/reset、既知の別件修正、UI 文言変更、デプロイは未実施。

## Eleventh Review Revision (2026-11-07)

- 親行の完了処理は、片の有無にかかわらず set が存在すればロック取得後に勝者を確認し、旧勝者への要求を 409 `SOURCE_ITEM_MISSING` で拒否する。未リンクで空の切削 set も同じ判定漏れを実 DB で再現できたため対象に含める。set がない通常行の処理とロック順は維持。
- 実 DB 回帰テストを7件追加。後工程・切削の空 set の勝者交代→旧行への完了要求（intent/toggle）→数量復帰、勝者不在の後工程の未完了片削除／完了証跡保持、隣接／飛び飛びの部分結合での空 set 取り込み、切削3行＋研削1行で連続する空 set の一段リンク・数量復帰・全結合を確認。リンク関連の5件は修正前から成功し、追加の不具合修正は不要だった。
- Known Limitations に、完了済みの空・未リンク切削 set の取り込み除外と、切削勝者不在中の後工程固定を追記。これらのコードは変更しない。

検証: API `tsc --noEmit -p tsconfig.build.json`、web `tsc --noEmit -p tsconfig.json`、両 package の `pnpm lint` は成功。API の sessaku-pieces 配下・route と production-schedule-command の `vitest run` は9ファイル・240件すべて成功（実 DB 統合122件を含む、64.13秒）。追加の7件は修正前に旧勝者への完了2件だけが失敗し、修正後の対象検証も成功。

指定 DB localhost:55491/lpp と既存の dotenv 無効化 preload・空の envDir 設定を使用し、秘密ファイルは読んでいない。検証は約3分で予算内。最終 `git diff --check` 成功。開始時の既存 WIP はなく、変更4ファイルは今回の修正のみ。branch feat/later-process-pieces・HEAD ae4e443a を維持。git の変更操作、migration/reset、既知の別件修正、UI 文言変更、デプロイは未実施。

## Twelfth Review Revision (2026-11-07)

- `isLaterProcessOrder` で数値として等しい工順（`010` / `10`）を同じ工程として扱い、後工程への片の伝播から除外する。
- 勝者の無い後工程 set のリンク解除をメモリ上にも反映し、空の切削 set 経由で取り込んだ場合も付け直さない。直接リンクと同じく version は1回だけ上がる。
- 実 DB 統合テストで工順の数値同値、直接／取り込み経由の分け直し・一部結合時のリンク解除と version、全結合時の FK 整合性を確認する。

検証: 指定 DB localhost:55491/lpp を両 DB 環境変数に設定し、dotenv 無効化・空の envDir で実行。sessaku-pieces 配下・route、production-schedule-command、process-order は10ファイル・248件すべて成功（実 DB 統合127件を含む、60.22秒）。API `tsc --noEmit -p tsconfig.build.json`、`pnpm lint`、最終 `git diff --check` も成功。最初の型チェックは `tsconfig.json` を指定したため既存の rootDir 設定エラーになり、計画文書指定の build 設定に訂正した。

今回の追加は統合テスト5件と既存2件の期待値更新、本文書への追記。本体の追加修正は不要だった。既存の未コミット修正3ファイルは保持し、branch feat/later-process-pieces・HEAD 7a174b4b を維持。秘密ファイルの読み取り、git の変更操作、migration/reset、既知の別件修正、デプロイは未実施。

## Thirteenth Review Revision (2026-11-07)

- 分割・結合の再検索で見つけた後工程について、取得済みの論理キーと親行ロックの両方を確認する。未ロックのキー／勝者行があればトランザクションを破棄し、発見済みのキーを含めてメール critical → 論理キー → board state → 行の順で取り直す。最大3試行で安定しなければ既存の 409 `STALE_SESSAKU_PIECES` を返す。
- 後工程候補に `supportsSessakuPieceRelations` を適用し、加工機コードが空の行への片作成・接続を除外。`isLaterProcessOrder` は片側でも trim 後に空なら false を返す。
- 実 DB 回帰テスト4件で、ロック直後の新規後工程追加／同一キーの勝者交代、再試行後の論理キー・親行 advisory・`FOR UPDATE`、競合 CSV 同期後の source links・数量・順序・Progress、再試行上限とロールバック、加工機コード空を検証する。停止処理は既存と同じテスト内トランザクションラップに限定し、本番用フックは追加しない。空工順の単体テスト3件と Known Limitations の指定事項も追記。

検証: 指定 DB localhost:55491/lpp を `DATABASE_URL` / `TEST_DATABASE_URL` に設定し、dotenv 無効化・空の envDir で実行。API `vitest run` の sessaku-pieces 配下・route、production-schedule-command、process-order は10ファイル・255件すべて成功（実 DB 統合131件、61.38秒）。API `tsc --noEmit -p tsconfig.build.json`、web `tsc --noEmit -p tsconfig.json`、両 package の `pnpm lint` と最終 `git diff --check` も成功。初回の同時実行テストは DB ドライバのエラー構造の期待値を修正し、その後に成功を確認した。

検証は約3分で予算内。開始時の既存 WIP はなく、変更7ファイルは今回の修正のみ。branch feat/later-process-pieces・HEAD 415c4a2b・空の index を維持。秘密ファイルの読み取り、git の変更操作、新規 migration/reset、UI 文言・監査テーブルの追加、既知の別件修正、デプロイは未実施。

## Fourteenth Review Revision (2026-11-07)

- 取り込み監査の製番＋品番の代表キーは `supportsSessakuPieceRelations` を満たすものを優先し、なければ従来どおり最後のキーを使う。propagate 監査には品番を保持し、parentItemId の decode をせず製番＋品番で集約する。
- commit 後の監査集約・記録で例外が出ても、既存の `sessaku_piece.audit_write_failed` 警告だけを出し、取り込みの成功や元の例外を変えない。
- 実 DB 回帰テスト6件を追加。補助 CSV 同期／CSV 完了反映の各バッチで、後工程数量が変わる行に加工機コード空／工順空の行が後続しても成功し、propagate 監査が1件残ることを確認。監査 DB 書き込み失敗時の成功維持も両経路で確認する。代表キーの優先・fallback、空キーの集約と品番の分離、監査準備失敗の警告について単体テスト4件を追加。

検証: 指定 DB localhost:55491/lpp を `DATABASE_URL` / `TEST_DATABASE_URL` に設定し、dotenv 無効化・空の envDir で実行。API `vitest run` の sessaku-pieces・production-schedule-command・order-supplement-sync・progress-sync は13ファイル・302件すべて成功（片の実 DB 統合137件を含む、49.99秒）。API `tsc --noEmit -p tsconfig.build.json`、`pnpm lint`、最終 `git diff --check` も成功。

開始時の既存 WIP はなく、変更6ファイルは今回の修正のみ。秘密ファイルの読み取り、git の変更操作、新規 migration／監査テーブル、UI 文言変更、既知の別件修正、デプロイは未実施。

## Fifteenth Review Revision (2026-11-07)

- 数量計画では完了状態にかかわらず未リンク片を残す。勝者不在中の分け直し／まとめるで元を失った完了片も、取消後に同じ ID・数量・`sourcePieceId=null`・override を保ち、再同期・再完了できる。保存する並び順はリンク片→未リンク片を維持し、構造変更時の `removeLaterPieces` と既存 detached 系 DB テストは変更しない。
- 合計調整は未リンク片→リンク片の順で既存の `planSessakuPieceQuantities` に委ねる。超過時は末尾の未完了リンク片から減らし、それでも超過する場合だけ未完了の未リンク片を後ろから減らす（数量0は削除）。単体テストでは未リンク2＋リンク1/2/2に対し、指示数5でリンク1/2＋未リンク2、指示数1で未リンク1、指示数0で空になること、完了片の保護と既存警告も確認する。
- `isLaterProcessOrder` の数値判定前に両辺を NFKC 正規化する。`compareProcessOrder` は変更しない。取り込み監査の代表キーは、そろったキーを優先し、その中で `encodeSessakuPieceKey` が最小のものを選ぶ。そろったキーがない場合の最後のキーへの fallback は維持する。
- 分け直し／まとめるの実 DB 回帰2件、数量の境界値・全角工順・代表キーの入力順に関する単体テストを追加。上記未採番製番の制約は記録のみでコードは変更しない。

検証: 指定 DB localhost:55491/lpp を両 DB 環境変数に設定し、dotenv 無効化・空の envDir で実行。指定 API 範囲14ファイル323件のうち、初回は322成功・完了片の位置保持1件失敗。保存順を修正後、関連する数量48件＋実 DB 統合139件がすべて成功（38.70秒）し、残る136件は初回成功。追加 DB テストの初回には自動作成済み override の重複作成を修正した。API `tsc --noEmit -p tsconfig.build.json`、package lint、最終変更2ファイルの ESLint、最終 `git diff --check` も成功。検証は約5分で予算内。

開始時に既存 WIP はなく、変更8ファイルは今回の修正のみ。branch feat/later-process-pieces・HEAD 6ce76118 を維持。秘密ファイルの読み取り、git の変更操作、migration/reset、監査テーブル・UI 文言の追加、既知の別件修正、デプロイは未実施。

## Sixteenth Review Revision (2026-11-07)

- 中-1は案(b)を採用。完了集約で片の合計が既知の指示数に満たない場合は未完了とし、割当解除・学習イベント保存を防ぐ。現在の補助 CSV の値を優先し、未同期なら set の保存済み指示数を使う。数量変更や追加ロックを必要とせず、数量が足りる正しい完了・外部完了・空のリンク set の扱いを維持する。`publishSessakuPieceSourceCreates` → `publishSessakuPieceProgress` を通る実 DB テストで、切削指示数0／全結合後の勝者復帰、割当・イベント保持、補助 CSV 再同期、通常完了と外部完了を確認。
- 中-2は全結合時に後工程の全片を親行への置換対象とし、各サイトの配置を引き継いで全片の override を消してから set を削除する。未リンク片のみ／未リンク完了片を取消後の実 DB テストを追加。
- 軽-1はバッチ間でも構造化した代表キーを保持し、加工機コード・工順のそろった最小の encode キーを選択する。最初の beforeJson・最後の afterJson は維持。既存バッチテストで入力順と未対応キーを含む parentItemId を検証。軽-2は勝者不在 set の片を変更したとき、リンクを維持する場合も version を上げる。軽-3は後工程の非数値工順比較も NFKC にそろえ、表の compareProcessOrder と表示値は変更しない。全角工順 `２` / `０１０` を operate が拾う実 DB テストも追加。
- 指定の確認事項3点はいずれも既知の制約として上記 Known Limitations に記録。数量の由来、既存の配置継承規則、関連論理ロックによる直列化を維持するため、追加の仕様変更は行わない。


検証: 指定 DB `localhost:55491/lpp` を `DATABASE_URL` / `TEST_DATABASE_URL` に設定し、dotenv 無効化・空の envDir で実行。sessaku-pieces 配下・route、production-schedule-command、process-order と影響する補助 CSV／Progress 同期は13ファイル338件を検証（実 DB の片統合150件を含む）。初回336件成功、正しい完了時の2件はテストの Prisma 全体への transaction spy が内部トランザクションまで捕まえていたため失敗。公開用クライアントだけを Proxy で包む形に訂正し、勝者復帰5件すべて成功（2.51秒）。他の333件は初回成功（全範囲70.54秒）。追加テストの最初の対象実行では割当fixtureの必須項目も訂正した。

API `pnpm exec tsc --noEmit -p tsconfig.build.json`、web `pnpm exec tsc --noEmit`、両 package の `pnpm lint`、最終編集した統合テストの ESLint、最終 `git diff --check` は成功。API は既存の rootDir 設定に合わせ build 設定を使用。検証は45分の予算内。開始時の既存 WIP はなく、変更9ファイルは今回の修正のみ。branch `feat/later-process-pieces`・HEAD `7bc78cfe` を維持。秘密ファイルの読み取り、git の変更操作、migration/reset、監査テーブル・UI 文言の追加、既知の別件修正、PR・デプロイは未実施。
