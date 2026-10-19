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

## Validation

Local rewarm validation (2026-10-19): the grinding-planning-board service test group and route tests passed (178 tests; 37 database integration tests skipped without `TEST_DATABASE_URL`). Coverage includes cold-build equality, recomputed seiban selection, concurrent reads, joining rewarm, failed-build retry, debounce/follow-up, site/store isolation and the three-entry limit. Changed TypeScript files passed ESLint, and `tsc --noEmit -p tsconfig.build.json` passed. The requested `tsc --noEmit -p .` remains blocked by the existing `rootDir: src` configuration including files outside `src` (TS6059); no config changes were made for this task.

Production Pi5, 2026-10-13, main `86dd89ef` (includes all four PRs), same kiosk:

| Time | First page | `/load` | Note |
| --- | --- | --- | --- |
| 09:15:17 | 4.15 s | 7.73 s | first open after the nightly CSV import changed the generation |
| 09:15:24 | 0.89 s | 0.18 s | 7 s later |
| 09:22:40 | 0.35 s | 0.26–0.32 s | 7.3 minutes later (previously a full rebuild) |

`CsvDashboardRawRevision.revision` for the production schedule dashboard moved from 0 (2026-10-09) to 150563 (2026-10-12 22:09), so CSV imports advance the token.

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
