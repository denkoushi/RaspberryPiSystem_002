# Kiosk grinding planning board

This is the living execution plan for the page at `/kiosk/production-schedule/planning-board` (the API route keeps the repository's existing `grinding-planning-board` naming). It is maintained according to `.agent/PLANS.md`; the plan itself is the only context a new contributor should need to continue the work. The feature lets a kiosk operator register production numbers, reorder that shared list, inspect unfinished work for a selected process, and save a page-specific resource and due-date plan without changing the existing due-management or leaderboard data.

## Purpose / Big Picture

The paper schedule is currently used to prioritize production numbers, move work between resource codes, and postpone due dates. After this feature is complete, the operator can perform those actions in one kiosk page. The page reads the original CSV winner row, existing due notes/supplements, existing completion state, and existing resource master, then overlays a site-shared production-number order and item-specific planning values. “Original” values remain read-only source values; all edits are stored in the two additive planning-board tables.

The behavior can be observed by starting the API and web applications, opening the kiosk planning-board route, selecting a production number and process, changing a resource or due date, and refreshing from a second terminal at the same site. The second terminal must see the shared order and override while the existing leaderboard and due-management pages retain their original values.

## Progress

- [x] (2026-09-09 13:30 JST) Confirmed existing winner identity, split display identifiers, completion union, site resolution, machine-name resolver, and resource-master candidate source.
- [x] (2026-09-09 13:40 JST) Added additive Prisma schema and migration for site board state and item overrides, including versions and unique keys.
- [x] (2026-09-09 14:05 JST) Added shared response/request contracts and registered the API route without changing existing public API meanings.
- [x] (2026-09-09 14:20 JST) Implemented board read projection, all-resource load calculation, source logical-key tracking, snapshot/cursor retrieval, shared-history seeding, and machine-name/progress integration.
- [x] (2026-09-09 14:25 JST) Implemented item/rank writes with RepeatableRead, parent-row locks, target item revision checks, resource-master/category checks, atomic bulk behavior, rank clearing, restore, and Prisma conflict mapping to HTTP 409; site-order writes remain Serializable.
- [x] (2026-09-09 14:44 JST) Added focused due-date tests and projection tests; the focused run reports 10 passing tests.
- [x] (2026-09-09 14:34 JST) Applied all migrations to the dedicated PostgreSQL database at `127.0.0.1:55442`; no existing database was used.
- [x] (2026-09-09 14:42 JST) Completed the dedicated PostgreSQL integration suite: seven tests pass against the loopback-only disposable database, including same-item conflict and distinct-item parallel success.
- [x] (2026-09-09 14:50 JST) Added focused route injection coverage for missing client keys, ignored foreign-site body input, and cursor-without-snapshot rejection; three tests pass.
- [x] (2026-09-09 15:04 JST) Completed frontend final build in approximately 19 seconds, 60 targeted tests, and ESLint. HTTP-mock UI checks verified normal three-column layout, focused two-table layout, 400 items, 50 registered production numbers, scrolling, and selection persistence.
- [x] (2026-09-09 15:04 JST) Supervisor review confirmed the diff, unchanged original checkout, final 1024px image, frontend/API evidence, and absence of leftover Vite/headless processes.
- [x] (2026-09-09 15:24 JST) Exercised the built API over real HTTP against a loopback-only disposable database with 20 production numbers × 20 items: the board returned 400 items over 160+160+80 snapshot pages, cursor-without-snapshot returned 400, a stale snapshot returned 409, and concurrent same-item writes from two client keys produced one 200 and one 409 without an automatic retry. Browser-to-API validation is being run separately by the web-validation contributor.
- [x] (2026-09-09 14:52 JST) Stopped and removed the disposable planning-board PostgreSQL container and removed temporary dependency links from the worktree; existing source-repository containers were not modified.
- [x] (2026-09-09 14:52 JST) Completed backend handoff. No commit, push, pull request, merge, deployment, or device distribution was performed in this worktree.
- [x] (2026-09-09 16:05 JST) Created commit `50fccc48` (`feat: add grinding planning board`) after the repository lint hook passed, pushed `feat/kiosk-grinding-planning-board-backend` to `origin`, and removed temporary dependency links. Pull request creation and hosted CI remain the next lifecycle stage; merge, deployment, and device distribution remain out of scope.

## Surprises & Discoveries

- The current winner row can change its database row ID after CSV re-import. Therefore normal item IDs encode the normalized text values of `FSEIBAN`, `FHINCD`, `FSIGENCD`, and `FKOJUN`, while split items use the persistent `ProductionScheduleOrderSplit.id`. A write resolves that logical identity again after locking the current source row.
- The repository's snapshot store is process-local and TTL-based. It already supports the required snapshot/cursor contract, so the board uses it with a board-specific fingerprint and refuses a cursor greater than zero without a snapshot ID. A wrong-site or wrong-filter snapshot is rejected without deleting the other scope's record.
- The shared search-history seed must be copied exactly once, including an empty history and production numbers whose rows have since disappeared. Falling back to current winners would silently change the user's registered order, so the board state is created from shared history only.
- A first implementation parsed `sourceRevision` on item writes even though item writes are guarded by target `itemRevision` and optional override version. The integration fixture intentionally passes a placeholder for item writes. Item writes therefore keep the source-revision field for the public contract but do not compare or parse board order; seiban-order writes alone parse and compare the strict `{boardVersion, orderHash}` revision.
- The first integration run reached six service scenarios successfully. The seventh initially stopped in fixture setup at the existing unique constraint on `(csvDashboardId, sourceCsvDashboardId, productNo, resourceCd, processOrder)`. After the fixture used unique source values, the service then exposed a PostgreSQL Serializable predicate-lock false conflict for independent override inserts. Switching item/rank transactions to RepeatableRead retained parent/source/item version locking and allowed independent items to proceed; same-item concurrency still yields one success and one 409.

## Decision Log

- Decision: Use two additive tables, `ProductionScheduleGrindingPlanningBoardState` and `ProductionScheduleGrindingPlanningBoardOverride`, rather than writing existing assignment, due, or rank tables. Rationale: original values must remain unchanged and the new page must be site-shared independently from device-scoped existing UI state. Date/author: 2026-09-09, backend_complete.
- Decision: Use the existing normalized logical-key semantics for normal items and persistent split IDs for split items. Rationale: this follows CSV winner replacement and prevents a deleted split from transferring an override to another split. Date/author: 2026-09-09, backend_complete and audit_requirements.
- Decision: Re-resolve the current winner and source details inside the same RepeatableRead item transaction after `CsvDashboardRow FOR UPDATE` and the existing parent-row lock; the site-order transaction is Serializable. Rationale: an out-of-transaction read may become stale between validation and write; retries are not automatic because a retry could double-add a due offset. Date/author: 2026-09-09, backend_complete.
- Decision: Validate candidate resources against the full existing resource master and preserve all same-category idle resources. Rationale: the resource master is the source of truth; hard-coded sample resources and group-code restrictions would hide valid choices. Date/author: 2026-09-09, backend_complete.
- Decision: Keep an empty override row and its version after restoring all values. Rationale: deleting the row permits an ABA replay to reuse an old version. Date/author: 2026-09-09, backend_complete.
- Decision: A resource or due value only clears alternate rank when the effective value really changes; an exact same-value request is a no-op. Rationale: a repeated request must not increment a version or erase an intentional rank. Date/author: 2026-09-09, backend_complete.
- Decision: Use the existing snapshot store with a binding fingerprint of site, category, view, selected production numbers, completion filter, and item generation. Rationale: it supplies the repository's established cursor semantics and avoids adding a second snapshot infrastructure. Date/author: 2026-09-09, backend_complete.
- Decision: Keep database integration on a disposable PostgreSQL container bound to `127.0.0.1:55442`. Rationale: the repository's existing containers must not be stopped or modified, and integration must exercise real migrations and transaction behavior. Date/author: 2026-09-09, backend_complete.
- Decision: Use RepeatableRead for item/rank override transactions and retain Serializable for site-order state updates. Rationale: the item path locks each parent row and current source row and validates the target item/override version; PostgreSQL Serializable predicate locks on an empty or small override table caused unrelated target inserts to conflict. RepeatableRead preserves stale-target detection without automatic retries, while the site-order row remains explicitly Serializable and locked. Date/author: 2026-09-09, backend_complete.

## Outcomes & Retrospective

The backend implementation now contains the additive schema/migration, shared contract, API route, service read projection, snapshot pagination, site-order seed/update, and atomic override/rank writes. The focused pure tests pass (`2 files, 10 tests`). All 172 migrations apply successfully to the disposable database. The dedicated integration suite passes all seven cases and proves seed isolation, 400-item snapshot pagination, wrong-scope cursor rejection, atomic bulk rollback, original-row immutability, completion rejection, same-item conflict, distinct-item parallel success, CSV winner tracking, split deletion rejection, and no parent-override inheritance.

The local implementation is complete. The final local evidence covers the backend API, frontend build/tests/lint, HTTP-mock 1024px UI behavior, and a real API-to-browser run against a disposable loopback database. Real-device performance remains outside this validation.

## Context and Orientation

The API package is `apps/api`. The existing production-schedule row resolver in `apps/api/src/services/production-schedule/row-resolver/` decides which CSV row is the current winner. `apps/api/src/services/production-schedule/grinding-planning-board-projection.ts` is a pure projection that turns winner rows, source details, ranks, overrides, split configuration, and filtered progress rows into board items and load. `apps/api/src/services/production-schedule/grinding-planning-board.service.ts` owns database reads, snapshot pagination, site-state seeding, resource/due/rank updates, version checks, and transaction boundaries. `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts` authenticates the client device through the existing route dependency and resolves the server-side site scope before calling the service. `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts` is the API contract consumed by the web package.

The two new models are additive. Board state stores one site order and a board version. An item override stores a logical item key, optional alternate resource, optional alternate due date, optional alternate rank, and an item version. An absent alternate value falls back to the original source value. A null override is a deliberate restore-to-original request and the row remains so its version cannot go backward.

The board displays unfinished work, including started work, and uses the existing internal-or-external completion union. Progress is calculated by `FSEIBAN` plus `FHINCD` after excluding the same machine and excluded-resource categories used by due management; instruction quantity is displayed separately and is never treated as processed quantity. Load includes unfinished work from every registered or unregistered production number and counts each logical item once against its original resource or effective alternate resource. Unknown required minutes remain an explicit unknown count.

Due requests are exact ISO calendar dates or positive calendar-day offsets. Offsets use effective due, then original due, then server-side Japan time; weekends and holidays count. An exact effective date is a no-op, and an earlier known effective date is rejected. Restore is separate from setting a date. The source category is retained, and a candidate resource must be present in the existing master and belong to that category.

## Plan of Work

First keep the schema and shared contract additive. Verify that the migration creates only the two board models and that no service path writes existing source rows, row notes, supplements, assignment/rank tables, or shared search history.

Next keep all broad reads outside the mutation transaction only for discovering which source rows must be locked. Within a RepeatableRead item/rank transaction, acquire the existing parent-row advisory lock, lock the current source rows, re-resolve the current winner and source details, compare each requested item revision and override version, and then write only board override rows. A source row disappearance, winner change, completion change, serialization failure, or unique-key race returns 409 and is never retried automatically. The site-order transaction remains Serializable, locks only the board state row, and compares the board version/order hash; an unrelated item change does not invalidate an order update.

For reads, fetch the full winner set and details once, resolve machine names with the existing batched resolver, filter requested production numbers and completion only for the returned page, and calculate progress and load from their separate populations. Use the existing snapshot store for all pages after the first; bind the snapshot to the site and filter fingerprint and retain a five-minute TTL. The first board state copies shared history exactly once and then stays site-specific, with a maximum of fifty entries and new registrations added at the front.

Finally connect the existing kiosk navigation and web controls to the contract. The web page must preserve checkbox exclusions across view changes, open a fixed target set for bulk editing, use the same editor for resource and due changes, and restore the previous list/selection after focused display. The frontend must use `seibanProgress` from the response rather than deriving progress from a filtered page.

## Concrete Steps

Run all commands from `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--kiosk-grinding-planning-board-backend`. The worktree dependencies are symlinked to the repository's installed pnpm store for local validation only; those symlinks are not source changes.

Apply the migration to a dedicated database, never to the repository's existing database:

    docker run -d --name grinding-planning-board-pg -e POSTGRES_USER=planning -e POSTGRES_PASSWORD=planning -e POSTGRES_DB=planning_board -p 127.0.0.1:55442:5432 pgvector/pgvector:pg15
    cd apps/api
    DATABASE_URL='postgresql://planning:planning@127.0.0.1:55442/planning_board' pnpm exec prisma migrate deploy

The expected migration result is `All migrations have been successfully applied`, including `20260909120000_add_grinding_planning_board`.

Run the narrow pure tests first:

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/grinding-planning-board.service.test.ts src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts

The expected result is two files and ten passing tests. These cover month/year boundaries, leap day, original/Japan-time fallback, invalid date/offset, exact-date no-op, restore, projection ordering, progress population, split handling, and unknown load minutes.

Run the dedicated integration suite only with the disposable URL:

    TEST_DATABASE_URL='postgresql://planning:planning@127.0.0.1:55442/planning_board' pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/grinding-planning-board.integration.test.ts

The expected final result is seven passing tests. The suite must prove seed-once/site isolation, four-hundred-item snapshot continuation, wrong-site and changed-filter 409s, resource-plus-due atomic updates, original source immutability, same-value no-op, internal/external completion rejection, all-or-nothing stale bulk updates, one-success/one-conflict same-item concurrency, independent different-item updates, current CSV winner tracking, deleted split rejection, and no parent override inheritance.

Run package validation after the integration suite:

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json
    pnpm --filter @raspi-system/api build

The API type check and build must exit with code zero. If a missing `playwright` or other package is reported, repair the worktree's dependency links using the repository's existing frozen pnpm install; do not add a dependency merely to make the worktree resolve.

For route authentication, inject the existing `KioskRouteDeps` in a focused route test and verify that a missing client key fails before service execution and that a client resolved to another site cannot supply a body site name to cross the scope boundary. For browser acceptance, run the web page test and manually inspect a 1024px viewport: normal mode has three columns when space permits, focused mode splits the selected production number into two tables, the top controls remain one row, long part names wrap, and selection/exclusion survives a view switch and focused-mode return.

When all checks finish, capture `git status --short` and ensure temporary `node_modules` links are ignored or removed from the worktree. Stop and remove only `grinding-planning-board-pg`; leave existing containers and the original repository worktree untouched. Do not create a commit, push, pull request, merge, deployment, or device package from this task.

## Validation and Acceptance

The backend is accepted when the focused pure tests, dedicated real-PostgreSQL integration tests, shared-types build, API type check, and API build all pass; the migration is applied only to the disposable database; and the integration evidence shows that source rows, source due notes, existing assignments/ranks, and shared search history remain unchanged after board writes. The web page is accepted when the route is reachable through existing kiosk navigation and the specified 1024px interactions work without losing target selection.

A response is invalid if it returns an item from a different site, uses a resource outside the source category or outside the master, changes a completed item, accepts an earlier due date, increments a version for an effective no-op, clears rank for an unchanged value, applies a deleted split, counts a parent and split together, or silently retries a stale offset request. A cursor greater than zero without its snapshot ID and a snapshot bound to another site/filter must return a clear 400/409 error and must not delete another scope's snapshot.

## Idempotence and Recovery

Reading the board and replaying a same-value update are idempotent. A bulk request either updates every validated target or updates none. A due offset request that receives 409 must be explicitly re-read and intentionally reapplied; clients must not automatically retry it. If migration or tests fail, stop the disposable container, create a fresh container on the loopback port, reapply migrations, and rerun only the narrow failed command. Never run integration tests against the existing production-like containers.

## Artifacts and Notes

The additive migration is `apps/api/prisma/migrations/20260909120000_add_grinding_planning_board/migration.sql`. The service and route are `apps/api/src/services/production-schedule/grinding-planning-board.service.ts` and `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts`. Pure tests are in `apps/api/src/services/production-schedule/__tests__/grinding-planning-board.service.test.ts` and `grinding-planning-board-projection.test.ts`; route scope tests are in `apps/api/src/routes/kiosk/production-schedule/__tests__/grinding-planning-board.route.test.ts`; the dedicated integration test is owned by the audit_requirements contributor and must not be duplicated.

Verification evidence collected so far:

    focused pure/projection run: 2 files, 10 tests passed
    route scope run: 1 file, 3 tests passed
    migration: 172 migrations applied successfully to planning_board at 127.0.0.1:55442
    integration: 1 file, 7 tests passed in 1.47s after the fixture unique-key correction and RepeatableRead item/rank transaction change
    shared-types build: passed
    API tsconfig.build typecheck: passed
    API build: passed
    frontend build: passed in approximately 19 seconds
    frontend targeted tests: 60 passed
    frontend ESLint: passed
    HTTP-mock UI: normal 3 columns, focused 2 tables, 400 items, 50 registrations, scrolling, and selection persistence verified at 1024px
    cleanup: disposable database stopped/removed; temporary dependency links removed from worktree

The approximately 35 minutes of verification time includes dependency-environment setup and failure investigation, the 10 focused pure/projection tests, the 3 route tests, the 7 real-PostgreSQL integration tests (including the initial fixture/Serializable failure and corrected rerun), migration application, shared-types build, API typecheck, API build, frontend build, 60 targeted frontend tests, ESLint, and HTTP-mock UI checks. Implementation time is excluded and each test/build/check is counted once.

## Interfaces and Dependencies

The response contract in `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts` includes `boardVersion`, strict compact `sourceRevision`, registered and selected production-number orders, source/effective item values, item revision and override version, resource candidates, load/unknown-minute count, `seibanProgress`, snapshot ID, and continuation cursor. Mutation contracts carry target item revisions and optional override versions. The service uses `Prisma.TransactionClient` for all transaction reads/writes, `Prisma.TransactionIsolationLevel.RepeatableRead` for item/rank changes, `Prisma.TransactionIsolationLevel.Serializable` for site-order changes, `acquireProductionScheduleParentRowLockInTransaction`, `buildMaxProductNoWinnerCondition`, `resolveSeibanMachineDisplayNamesBatched`, `isProductionScheduleOrderSplitEnabled`, and `LeaderboardShellSnapshotStore`. No new runtime dependency or second resource/site master is permitted.

## Plan Revision Note

2026-09-09 15:04 JST: Updated the living plan with final frontend build/test/lint and 1024px HTTP-mock evidence, supervisor review, 35-minute total verification accounting, and the boundary that real API/browser E2E and real-device performance remained unverified at that point. Local implementation is complete; no commit, push, PR, merge, deploy, or device distribution was performed.

## Real API browser validation

2026-09-09 15:20–15:25 JST: Started only the dedicated PostgreSQL container `grinding-planning-board-pg-e2e` on `127.0.0.1:55442` and exercised the built API on `127.0.0.1:8081` with a synthetic client key and 20 production numbers × 20 rows (400 logical items). The dedicated-DB HTTP run used no browser request interception or HTTP mock. A separate browser run was reported by the web-validation contributor; its `127.0.0.1:18080` listener was not attributable to this worktree and was therefore excluded from the dedicated-DB provenance claim.

The reported browser run verified the initial unfinished view (20 panes, 320 rows), both-status view (20 panes, 400 rows), focused view (20 rows split across two tables), resource view (4 resource tables, 400 rows), normal scroll to later production numbers, exclusion, resource-plus-due bulk change, restore to original values, individual rank set/clear, order move, remove/register, and focused return. The dedicated-DB HTTP run observed snapshot pagination as 160+160+80 with 400 unique item IDs; two independent client keys produced one 200 and one 409 on stale override writes, and the 409 response did not retry automatically. The browser run was subsequently repeated against the same dedicated DB through API port 8081 with the prefixed fixture key, and its API/database provenance is recorded below.

The original-allocation drawer controls that previously appeared enabled while being no-ops were changed to disabled. Successful order writes now clear the pending optimistic marker from the mutation response before accepting a competing server order, and active製番 selection changes are committed only after the shared order write succeeds, so a 409 cannot silently remove a selected production number. The focused page test now reports 7 passing tests after these changes; the web build passes. Evidence and screenshots are in `/Users/tsudatakashi/Documents/Codex/2026-09-09/analog-a3-cd-cd-ui/outputs/planning-board/real-api-evidence.json`, `real-api-order-conflict.json`, `real-api-normal-1024.png`, `real-api-normal-scroll-next-seiban.png`, `real-api-focus-1024.png`, and `real-api-resource-1024.png`.

After evidence capture, stop only the API/Vite processes and remove only `grinding-planning-board-pg-e2e`; leave repository containers and the original checkout untouched.

2026-09-09 15:50 JST: Repeated the browser run with the correct dedicated fixture, API `http://127.0.0.1:8081`, Vite `http://127.0.0.1:4173`, and the loopback-only database at port 55442. Playwright observed the real API (no request interception), 20 panes/320 unfinished rows, 400 rows in the all-status view, two focused tables, four resource views, bulk resource-plus-due change and restore, rank set/clear, shared-order edits, original-value read-only controls, and one 200/one 409 from two browser contexts with explicit refresh. Dedicated evidence is in `outputs/planning-board/dedicated-browser/` and `real-api-dedicated-http-evidence.json`; source row resource 305 and due note 2026-09-12 remained unchanged while board state/override rows changed.

2026-09-09 15:36 JST: Added a synchronous `pendingOrderRef` guard and `orderBusy` drawer state so repeated製番順 clicks issue one request and disable shared order controls until the mutation settles. Rank 409 feedback now exposes the same explicit latest-state refresh button as order conflicts. The focused page suite passed 9 tests, including these two cases. Web `tsc -b` passed; the single web build reached Vite but failed to resolve the pre-existing `zod` import from `packages/shared-types/dist/overlay/normalized-overlay.js`, so no dependency or unrelated build workaround was added. Temporary dependency symlinks were removed afterward.

2026-09-09 15:58 JST: Corrected the real-browser provenance. The final web build passed (`tsc -b` and Vite, 2156 modules, 8.44s) after restoring the worktree's existing package symlinks; no dependency or source workaround was added. The final CUA browser tab used Vite `127.0.0.1:4174` against this worktree's API `127.0.0.1:18081`, backed by disposable PostgreSQL `127.0.0.1:55442` (`grinding-planning-board-pg-e2e`). It loaded 20 registered製番 and 320 incomplete rows, opened and closed the E2E-01 focus view, clicked resource 581 and `+暦日`, observed `1件を更新しました。` with the row at 581/09-13, then clicked both `元に戻す` controls and observed the row return to 305/09-12 before returning to the normal 320-item list.

The browser action record is `outputs/planning-board/real-api-browser-cua-18081.json`; dedicated API pagination and A/B stale-write evidence is `outputs/planning-board/real-api-evidence-18081.json` (200/409/restore 200, no automatic retry). Port 18080 was not used and its other-worktree process was left untouched. After this record was written, stop only the API/Vite processes and the disposable database started for this check; do not stop repository services or the 18080 process.

2026-09-09 16:02 JST: Final evidence authority is `outputs/planning-board/dedicated-browser/real-api-evidence.json` and its four screenshots, produced by the dedicated full browser run against this worktree's API `127.0.0.1:8081`, Vite `127.0.0.1:4173`, and disposable DB `127.0.0.1:55442`; it includes the real browser interactions and two-context 200/409/restore flow. The 18081 CUA record above is supplementary click-path evidence only. Any earlier 18080 evidence is rejected because that listener belonged to another worktree; the old connection provenance was left unresolved and no current 55440 database/process was used or modified. Our 18081/4174 servers, dedicated browser tab, and disposable database were stopped after capture; 18080 was left running.
