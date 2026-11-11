# KB-418: 製番ボード (grinding planning board) reopens were rebuilt every time

- Status: `active`
- Scope: kiosk 製番ボード (`/kiosk/production-schedule/planning-board`), API `GET /api/kiosk/production-schedule/grinding-planning-board` and `/load`

## Context

2026-10-09. Opening 製番ボード on a kiosk took 5–12 s on almost every visit. Measured from the Pi5 Caddy access log (`/var/log/caddy/`, JSON `duration`).

## Symptoms Or Trigger

| Endpoint | Before | Reopen inside the cache window (after #1897) |
| --- | --- | --- |
| `grinding-planning-board` (first page) | 4.6–5.4 s | about 1.5 s |
| `grinding-planning-board/load` | 9.3 s | about 0.7 s |

The fast case almost never happened in production: kiosks reopen the board less often than the cache windows below.

## Investigation

- The API already reused results while the planning generation token was unchanged, but every reuse path had a short time limit unrelated to data changes.
- The generation token was read from `CsvDashboardRow` itself (about 6 million rows in total) on every request.
- After #1904, `/load` stayed fast after 11 minutes (0.49 s) while the first page did not (3.46 s). The first-page payload lived only in the shared cursor snapshot store (`routes/kiosk.ts`, 5 minutes, shared with 順位ボード continue).

## Root Cause

Three independent time limits forced a rebuild although the source data had not changed:

1. The winner `baseWhere` was recomputed per request.
2. The `/load` aggregate cache expired after 10 minutes. The limit was a safety valve because the token missed delete-only changes in three tables.
3. The first-page payload expired with the cursor snapshot after 5 minutes.

## Fix

| PR | Change |
| --- | --- |
| #1897 | Resolve the winner `baseWhere` through the generation cache |
| #1902 | Read the `CsvDashboardRow` part of the token from a one-row revision (`CsvDashboardRawRevision`, maintained by 4 triggers; migration `20261009120000_add_production_schedule_row_revision`) |
| #1904 | Add `progressCount` / `externalCompletionCount` / `orderSupplementCount` to the token, then keep the `/load` aggregate for 12 hours |
| #1909 | Keep the completed first-page payload in a per-store cache (16 entries, LRU, 12 hours) checked against the token; cursor snapshots keep their 5 minutes |

All caches are in process memory and disappear when the API container restarts. The 12-hour limit remains only as an upper bound for a future write that does not advance the token.

Behaviour change in #1909: when the token changes during the reuse check of a first page, the API rebuilds instead of returning 409 at once; the final token check still returns `STALE_PLANNING_BOARD_SNAPSHOT` if the data keeps changing.

### Rewarm after board writes (2026-10-19)

Successful kiosk PUTs for overrides, pins, rank, resource-order (including bulk), seiban-order and due-scope schedule a background rewarm; resource-capacity does not. The per-store/site scheduler debounces for 200 ms and collapses writes during a run into one pending follow-up. Each run rebuilds at most three unexpired entries with the newest `lastUsedAtMs`, sequentially, using the normal first-page preparation and cold-build path.

The generation token remains unchanged. Rewarm stores the original deduplicated `requestedFseibans`, so a seiban-order write recomputes the selected list against the latest registered order. Builds share a per-store promise keyed by filter fingerprint and generation; a real first-page read can join it and still creates its own cursor snapshot. Successful background builds populate the existing 12-hour/16-entry cache without cursor creation, material-arrival lookup or the normal request performance flush. Reuse updates recency without extending expiry. Background errors are logged at debug and never affect the write response.

### Live placement badges (2026-10-25)

Placement is response-only enrichment, like material arrival: it does not enter cached projections, cursor snapshots, generation tokens or `itemRevision`. Each page batches its trimmed `productNo` values into one `OrderPlacementBranchState` query restricted to `slipKind = manufacturing_order`, then resolves `MobilePlacementShelf` labels in one batch. Branches on the same shelf collapse to the newest `updatedAt`; shelves appear newest first, with raw shelf codes as the label fallback. No matching state means no `placement` field.

The three table badge positions show the sky placement badge instead of material arrival; the forward Gantt process-chip strip shows only the placement badge (it never had a material badge). Multiple shelves open a list through the existing anchored portal, avoiding clipping by table/track overflow; clicking the badge does not select or drag the row. Dates use the kiosk Tokyo formatter, and old records retain the same tone. Gantt strip fitting reserves badge width and shifts a following strip when even the badge and folded chips cannot fit on the two available lines. Other Gantt modes and screens are unchanged.

Device follow-up (2026-10-25): the forward Gantt showed no badge on the device, because a strip is drawn once per part (seiban + part code) under the part's first bar, while placements match per process row's `productNo`; the matched row could be a later process or a completed one (completed rows are not forward bars). The page now merges every visible row's shelves per part key (`PlanningBoardPlacementContext`, newest first, deduplicated by shelf code) and the forward strip reads that map, falling back to the bar's own item. Tables still show each row's own placement.

## Validation

Local placement validation (2026-10-25): API service orchestration tests passed (65), along with the web badge, table, chip-strip and Gantt view tests (103). Shared-types build, web `tsc --noEmit`, API `tsc --noEmit -p tsconfig.build.json`, targeted ESLint and `git diff --check` passed. The worktree first needed Prisma Client generation and builds of the existing `shelf-layout-core` / `part-search-core` packages. No database, commit, push or deploy was used.

Local rewarm validation (2026-10-19): the grinding-planning-board service test group and route tests passed (178 tests; 37 database integration tests skipped without `TEST_DATABASE_URL`). Coverage includes cold-build equality, recomputed seiban selection, concurrent reads, joining rewarm, failed-build retry, debounce/follow-up, site/store isolation and the three-entry limit. Changed TypeScript files passed ESLint, and `tsc --noEmit -p tsconfig.build.json` passed. The requested `tsc --noEmit -p .` remains blocked by the existing `rootDir: src` configuration including files outside `src` (TS6059); no config changes were made for this task.

Production Pi5, 2026-10-13, main `86dd89ef` (includes all four PRs), same kiosk:

| Time | First page | `/load` | Note |
| --- | --- | --- | --- |
| 09:15:17 | 4.15 s | 7.73 s | first open after the nightly CSV import changed the generation |
| 09:15:24 | 0.89 s | 0.18 s | 7 s later |
| 09:22:40 | 0.35 s | 0.26–0.32 s | 7.3 minutes later (previously a full rebuild) |

`CsvDashboardRawRevision.revision` for the production schedule dashboard moved from 0 (2026-10-09) to 150563 (2026-10-12 22:09), so CSV imports advance the token.

## Client Snapshot Replacement (2026-11-06)

- Symptom: the 5-minute planning-board refresh replaced the completed list with the first 160 items while cursor pages were pending, temporarily removing later Gantt bars.
- Fix: `useKioskGrindingPlanningBoardProgressive` keeps the completed snapshot for the same `paramsKey` and buffers the replacement pages locally. Only the final page publishes the replacement. Initial loading and scope changes still publish each page; a first page without a cursor replaces immediately.
- Readiness follows the displayed snapshot: background replacement keeps `hasStableData`, `scopeReady` and `isComplete` true and `isAppending` false. The page's rank readiness conditions stay satisfied without showing 「一覧を追加取得中…」.
- Cursor failures, including exhausted STALE 409 retries, retain the completed display and readiness, and use the existing `appendError` notice. Initial partial-load failures remain incomplete. A manual `refetch()` reports replacement failure through `isError`.
- `refetch()` now waits for the replacement to be published and rendered, including STALE retries. Write-queue refresh and conflict recovery therefore cannot acknowledge only the first page or prematurely clear confirmed writes. The existing item and order overlays retain acknowledged changes and pass the confirmed source revision to the next save; the write queue and page need no changes.
- Validation: progressive-hook tests passed (22 tests, about 3 seconds), including polling, explicit refetch, invalidation, multiple deferred pages, initial/scope progressive loading, STALE retry exhaustion and a connected write-queue check for saved fields, confirmed order and source revision. Planning-board feature/page tests passed (30 files, 435 tests, about 12 seconds). Web `tsc --noEmit` passed after rebuilding the existing shared-types output, which was stale locally. No API code, page sizes or polling intervals changed.

## Schedule-source dropdown and scoped reuse (2026-11-09)

- The toolbar uses one shared portal dropdown for 「区分」 and 「工程」, following the existing single-resource picker's zoom, dismissal and focus behavior. The source preference uses `kiosk-planning-board-schedule-source`, schema version 1, default `both`; the existing category preference is unchanged.
- Board reads, deferred `/load` and `/process-chips` accept `scheduleSource=general|dCompany|both`. The source helper reads the existing minutes-kind memberships: `INTERNAL` matches 一般, `D_COMPANY` matches D社, dual membership matches either, and missing membership remains visible in every source. `both` bypasses the membership read and retains the existing SQL predicates.
- The server filters the selected seibans before reading/projecting board items and adds bound exclusions to the existing load predicate. Process-chip identities are filtered on the API; special-due counts continue to derive from the returned display items. Resource capacity/minutes settings and per-seiban due detail retain their existing scope. Registration candidates, registrations/count/limit, machine names and unchecked registrations remain unfiltered.
- The source is part of web query keys, the progressive hook's existing `paramsKey`, write/history scopes, server snapshot fingerprints, rewarm requests and load-cache keys. Fingerprints also include the resolved exclusions, so a changed membership set cannot reuse a previous filtered payload/cursor without a CSV-generation change.
- Seiban-order writes still use the complete `registeredFseibans`. Resource drag and bulk requests carry the source; filtered rank writes merge the requested order into the complete resource order while preserving the slots of hidden items. Rank numbers can be normalized to preserve that global order; registration state is not replaced with a visible subset. Filtered responses contain only the requested/visible items.
- Local verification: the isolated API source/order tests passed (8 tests). Web toolbar/preference/client tests had 64 passes and one existing single-resource picker accessible-name failure; the unchanged HEAD component/test reproduced the same failure. Page/progressive and API service tests could not collect because the installed Zod 3 lacks `guid()` used by existing shared types; route collection also hit a missing `@prisma/adapter-pg`. Shared-types build and web/API type checks failed against existing dependency/generated-type mismatches; changed-file ESLint could not start because `typescript-eslint` was absent. Full acceptance verification remains incomplete. No PostgreSQL integration tests, commit, push or deployment were performed.

## Write queue recovery (2026-11-10)

- Failed recovery blocks writes until polling supplies a changed board revision or item-array reference, or an explicit refresh is accepted. Successful recovery reads the complete refetch response revision before continuing independent queued writes; known stale revisions cannot replace it.
- A successful due-scope mutation remains a successful save even if its follow-up reads fail. The existing refresh error is shown in due detail. If the board read fails, edits for that seiban stay pending until a complete board refresh supplies an item revision beyond the captured and confirmed revisions; other seibans and independent queued writes can continue. Processing-scope writes can leave other items in the same seiban unchanged. A due write that changes no item revision (same date) never satisfies that condition, so the explicit refresh in due detail (`acceptRefreshedState`) also releases held seibans.
- Unmount cancels unsent writes through their failure callbacks; in-flight responses are ignored. Due-action callbacks guard state updates after unmount.
- Missing-item confirmed entries are intentionally retained: item absence and an opaque board revision alone cannot distinguish a delayed pre-save snapshot from a post-save removal. Removing them without that evidence could break the stale-GET overlay. This leaves the original long-session retention concern unresolved.
- Scope: local web implementation and focused regression tests only; no API, database or deployment changes.
- Local validation: queue tests passed (13); focused due-save/refetch and order-conflict/stale-GET page tests passed (5). The original queue failed the three new recovery/unmount regressions. The full page file had 206 passes and one split-button enabled-state failure; the same split test timed out with the unchanged HEAD queue/test, so complete page acceptance remains unverified. Web type checking passed after building the existing `part-search-core` dependency, and changed-file ESLint passed.

## Settings refresh across kiosks (2026-11-10)

- **Symptom**: daily hours and per-part minutes edited on one kiosk did not reach a board left open on another kiosk (the queries had a 10-minute `staleTime` and no interval, and the board stays mounted for days).
- **Fix**: both settings queries refetch every 60 seconds (`PLANNING_BOARD_SETTINGS_REFETCH_MS`). A capacity save that finishes while a fetch is in flight invalidates the query, so the older fetch cannot bring back the previous value.
- **Not covered**: if a periodic fetch finishes while a capacity save is still in flight, the board can show the old value until the save returns.

## Prevention

- Unit tests cover reuse across the 5-minute store lifetime, token change, the 12-hour limit and LRU eviction (`grinding-planning-board.service.unit.test.ts`); delete-only token changes are covered in `leaderboard-shell-snapshot-generation` tests.
- When a new input is added to the board projection or the load aggregate, add it to the generation token. A missing input now stays stale for up to 12 hours instead of 5–10 minutes.

## Open Items

- The first open after CSV imports, process restart, cache expiry or a filter outside the three rewarm candidates still requires a cold build. Board writes now schedule rewarm, but the Pi5 latency benefit has not yet been measured in production. The `/load` generation contract is unchanged.
- `leaderboard-board` (`processChangeResidualSummary`, about 12 s) was not addressed.
- `shared_buffers` and retention / VACUUM of `CsvDashboardRow` were not changed; they need a separate decision.

## References

- PRs #1897, #1902, #1904, #1909
- `apps/api/src/services/production-schedule/grinding-planning-board.service.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-load-summary.ts`
- `apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-snapshot-generation.ts`
- Stage timing log: `GRINDING_PLANNING_BOARD_PERF_LOG=true` (off in production)
