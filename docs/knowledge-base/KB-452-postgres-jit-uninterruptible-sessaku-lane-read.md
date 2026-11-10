# KB-452: PostgreSQL 18 JIT stalls the sessaku lane read for minutes and cannot be cancelled

- Status: active
- Scope: API `readWinnerRowsByFseibans` with a lane scope (manual sessaku piece split/merge and the sequential comparison in the automatic unit split tests); PostgreSQL 18.6 (`pgvector/pgvector:pg18`, same image as Pi5)

## Context

2026-11-10, while testing the automatic one-by-one split (`claude/sessaku-auto-split-fix`), the DB test `rolls back one lot and its audit while splitting the rest` stalled for minutes. The stall was not in the batch path. It was in the sequential comparison, which uses the same read as the manual split.

## Symptoms Or Trigger

- One backend uses CPU continuously, `wait_event` is empty, and the query never finishes.
- It holds the advisory lock, so later splits wait behind it (the second stall in the test run was this wait).
- `statement_timeout` (120 s) only fired after 7 min 53 s. `pg_terminate_backend` did not stop it either. JIT compilation does not check for interrupts.
- Trigger: the lane read adds a tuple `IN` list of inbound logical keys (`(FSEIBAN, FHINCD, FSIGENCD, FKOJUN) IN (...)`). In the test fixture it had about 4,400 tuples (17,653 bound values). The plan cost was 914,094, above `jit_above_cost` (100k), `jit_optimize_above_cost` and `jit_inline_above_cost` (500k), so PostgreSQL compiled it with inlining and optimization.

## Investigation

- Same SQL and values: `jit = off` → planning 91 ms, execution 74 ms. `jit = on` → stuck for 7 min 53 s, then `statement timeout`.
- `ALTER DATABASE autosplit_test SET jit = off` on the test container, then the failing test 10 times alone → 10/10 passed (about 59 s each).
- `origin/main` builds the same `IN` list, so the manual split already carries this risk in production. It only matters when there are many inbound (reassigned) keys.

## Root Cause

The lane-scoped read's large tuple `IN` list raises the planner cost estimate above the JIT thresholds. The query runs in milliseconds, but PostgreSQL 18 JIT compiles it for minutes, and the compile is uninterruptible.

## Fix

`readWinnerRowsByFseibans` runs `SET LOCAL jit = off` before the read when the lane scope has inbound keys. `SET LOCAL` only lasts for the current transaction. A root Prisma client gets its own short transaction so the setting and the read use the same connection. `ALTER SYSTEM`, `ALTER DATABASE` and session-level `SET` are not used, and production settings are unchanged.

Callers (2026-11-11): only `sessaku-pieces.service.ts` `readProjectionSource` passes a lane scope, inside its transaction. `completion.ts`, `apply-d-schedule-minutes.service.ts` and `auto-unit-split.service.ts` never pass one, so they never build the `IN` list.

## Prevention

- DB test `turns JIT off only for the transaction of a lane read with inbound keys`: in a transaction with `SET LOCAL jit = on`, the setting stays `on` after a read without a lane or with no inbound keys. It is `off` after a read with inbound keys. A root-client read uses a separate client with `connection_limit=1`; the test checks the same backend PID before, during and after the read, observing `on`, `off` immediately after `SET LOCAL`, then `on` again. With the old code this test fails (`withInbound: "on"`).
- The 8-minute stall is not in CI. Reproduce it by hand as described below.
- Possible follow-up (not done): replace the `IN` list with an `unnest`/`VALUES` join so the cost estimate stays low.

## Recovery when it happens

Cancelling the query or terminating the backend does not work while JIT is compiling. Restart the PostgreSQL container (`docker restart <db container>`), then check that the advisory lock waiters are gone.

## Validation

Manual reproduction (test container only):

1. Start `pgvector/pgvector:pg18` and point `TEST_DATABASE_URL` at it. Make sure `SHOW jit` is `on`.
2. Use the code from before this fix (`readWinnerRowsByFseibans` without `SET LOCAL jit = off`).
3. Run `pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts -t "rolls back one lot and its audit"`. The sequential comparison stalls, and `pg_stat_activity` shows the lane read active with no wait event.
4. With this fix, and `jit` still `on`, the same command finishes. Counted results are in the PR.

## References

- Branch `claude/sessaku-auto-split-fix`
- Code: `apps/api/src/services/production-schedule/grinding-planning-board/source.ts` (`readWinnerRowsByFseibans`)

## Integration test follow-up (2026-11-11)

- The legacy VALUES comparison had a separate test instrumentation bug: Prisma 7.10.1 transaction clients expose `$transaction` and inherit the root client's spy. Its unrestricted mock re-entered `countDriverSql` for the nested lane read. The inner `vi.spyOn(pg.Client.prototype, 'query')` reused the outer spy, so the saved `query` called itself. A DB-free reproduction produced `RangeError: Maximum call stack size exceeded` with alternating frames at `Reflect.apply(query, this, args)` and Vitest's `Client.query`. Restricting the reference transaction mock with `mockImplementationOnce` preserved the real nested transaction and passed the same reproduction. Production code was not changed for this instrumentation issue.
- Automatic lot recovery now retains the raw transaction client for `ROLLBACK TO SAVEPOINT` and its following `RELEASE`. A cooperative probe must not run before recovery because PostgreSQL rejects it with `25P02` while aborted. SAVEPOINT creation and successful release retain cooperative checks. The regression injects PostgreSQL division by zero (`22012`) after a lot's writes, waits 50 ms, and compares surviving lots, placements and audits against sequential splits.
- Local validation (2026-11-11, `pg-autosplit-test`, jit on): the 8 related DB tests passed (legacy VALUES head/tail, four lot-rollback cases, the PostgreSQL-aborted lot, the JIT test). With recovery routed back through the cooperative proxy, the PostgreSQL-aborted lot test fails: the probe gets `25P02`, every later lot is skipped and the call ends with `25P02`.

## Automatic split runner (2026-11-11)

The automatic split runner also runs `SET LOCAL jit = off` once, right after it takes its advisory lock. Its batch queries stayed under 100k cost in the test DB (highest 25,741; `CsvDashboardRow` 25,739 rows, analyzed), but production `CsvDashboardRow` holds about 6 million rows (KB-418), so the margin to `jit_above_cost` cannot be shown there. The setting is limited to the runner transaction.
