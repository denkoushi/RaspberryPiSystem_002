# Restore Gmail CSV throughput during OrderSupplement backlog processing

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After a router outage and a hung Gmail API request, the Gmail CSV scheduler can reach its backlog again. However, one `ProductionSchedule_OrderSupplement` message currently spends more than seven minutes mapping supplemental order keys to the winning production-schedule rows. The Gmail scheduler uses one shared cycle lock, so this CPU-bound database query causes unrelated scheduled imports to be skipped.

This change must preserve the exact existing winner rule and supplement results while making the key lookup finish quickly enough that the shared Gmail cycle is released. Success is visible in production when an OrderSupplement cycle completes, subsequent scheduled CSV imports start rather than logging `Cycle skipped because previous cycle is running`, and the database no longer remains at full CPU for minutes on the winner lookup.

## Progress

- [x] (2026-07-25 06:32Z) Confirmed the Gmail request hang is fixed and the scheduler can process messages again.
- [x] (2026-07-25 06:32Z) Confirmed ten MeasuringInstrumentLoans attachments are BOM-only three-byte files; they are non-retriable input, not a header alias change.
- [x] (2026-07-25 06:32Z) Confirmed OrderSupplement winner lookup is active for more than seven minutes and causes the 06:30Z MeasuringInstrumentLoans and rigging schedules to be skipped.
- [x] (2026-07-25 06:49Z) Captured the production read-only query plan and rejected the repeated index-probe variant after it still exceeded a 30-second bounded probe under load.
- [x] (2026-07-25 06:49Z) Added a SQL-shape regression test and a PostgreSQL integration case for the maximum-ProductNo winner.
- [x] (2026-07-25 06:49Z) Implemented one canonical window ranking of the main schedule before joining supplemental keys; no schema or winner-rule change.
- [x] (2026-07-25 07:11Z) Audited existing retention and production date distribution; added guarded one-year source retention for old unmatched rows only.
- [x] (2026-07-25 07:11Z) Re-ran focused validation: unit 18/18, disposable-PostgreSQL integration 4/4, API build, API lint, and `git diff --check`.
- [x] (2026-07-25 07:14Z) Committed and pushed `3333373c`; opened draft PR #1084.
- [ ] Wait for PR #1084 CI, mark ready, merge, and verify the immutable main SHA.
- [ ] Run `--print-plan`, the release-readiness preflight, and the standard Pi5-only rolling deployment.
- [ ] Verify the backlog drains, later schedules are not skipped, health remains OK, and close this plan.

## Surprises & Discoveries

- Observation: the apparent MeasuringInstrumentLoans column mismatch is caused by empty attachments, not by a renamed column.
  Evidence: all ten saved failed attachments in the active API container are exactly three bytes and contain only UTF-8 BOM bytes `ef bb bf`.

- Observation: the post-ingest OrderSupplement projection is now the active shared-lock holder.
  Evidence: PostgreSQL showed the `WITH input_keys AS ... jsonb_to_recordset` query active for more than seven minutes with `docker-db-1` near 100% CPU; both 06:30Z Gmail jobs logged `Cycle skipped because previous cycle is running`.

- Observation: production currently has 59,141 main production-schedule rows and 111,975 accumulated OrderSupplement source rows.
  Evidence: a read-only grouped count of `CsvDashboardRow` on the two fixed dashboard IDs.

- Observation: merely changing the candidate predicate to the existing normalized residual-key index was insufficient during production saturation.
  Evidence: `EXPLAIN` selected `csv_dashboard_row_prod_schedule_residual_key_idx`, but a bounded 10,000-key `EXPLAIN ANALYZE` still exceeded 30 seconds while the old production query was active.

- Observation: ranking the main rows once removes the cardinality multiplier.
  Evidence: on a disposable PostgreSQL database with 59,141 main rows and 111,975 supplemental keys, the old correlated lookup exceeded a 15-second statement timeout while the new canonical window-ranking query returned 20,000 expected winners in 420.180 ms.

- Observation: existing generic CSV retention does not bound this source dashboard to one rolling year.
  Evidence: `cleanupOldData()` only deletes rows in the full calendar year two years before the current year. The OrderSupplement dashboard has no date column, so its `occurredAt` is import time. Production's 111,975 source rows were all created between April and July 2026, while their business planned dates span 2025 through 2027.

- Observation: a business-date retention rule can reduce stale source rows without deleting current or future work.
  Evidence: 3,728 production source rows had planned end/start dates older than the rolling one-year cutoff. The implemented guard additionally requires that the exact ProductNo/resource/process key have no current main-schedule winner. Rows with a current winner, a future/recent business date, or no parseable business date are retained.

- Observation: the in-flight old production query eventually completed without intervention.
  Evidence: the 15:24 JST OrderSupplement cycle completed at 15:56 JST with `scanned=111975`, `matched=27687`, `unmatched=84288`; at 16:00 JST the next rigging Gmail cycle started and processed messages, proving the shared lock was released.

## Decision Log

- Decision: do not add `管理番号` or any other header alias to the MeasuringInstrumentLoans dashboard.
  Rationale: an alias cannot make a BOM-only attachment valid and would hide the actual input defect.
  Date/Author: 2026-07-25 / Codex

- Decision: allow the in-flight OrderSupplement transaction to continue while preparing and validating the fix.
  Rationale: it is actively consuming CPU and making progress; forcibly terminating it could leave the current email un-post-processed and is not required for safe diagnosis.
  Date/Author: 2026-07-25 / Codex

- Decision: preserve `buildMaxProductNoWinnerCondition` semantics and optimize only how candidate rows are located.
  Rationale: changing the winner rule could attach quantities or dates to the wrong production order, while an expression/index-compatible candidate predicate can reduce work without changing results.
  Date/Author: 2026-07-25 / Codex

- Decision: use the existing canonical partition and ordering helpers to rank all 59,141 main rows once, then hash-join the supplemental keys.
  Rationale: repeated index probes still multiply work by the supplemental-key count. `buildMaxProductNoLogicalKeyPartitionExprs` and `buildMaxProductNoWinnerSelectionOrderBySql` are already the shared definition used by winner materialization, so the one-pass query is both faster and winner-equivalent.
  Date/Author: 2026-07-25 / Codex

- Decision: retain source rows for one rolling year by business date, but delete only rows whose exact key has no current main-schedule winner.
  Rationale: deleting by import time would not reduce the accumulated business history, and deleting solely by an old planned date could remove a long-running current order. Planned end date (falling back to planned start date) plus the current-winner guard preserves current, future, and unknown-date work.
  Date/Author: 2026-07-25 / Codex

- Decision: run source retention after successful supplement replacement and treat cleanup failure as warning-only.
  Rationale: storage convergence must not turn an otherwise successful Gmail import into another shared-lock blocker. The cleanup is idempotent, dashboard-scoped, and chunked.
  Date/Author: 2026-07-25 / Codex

## Outcomes & Retrospective

Work is in progress. The Gmail network timeout and router path are already healthy; the remaining blocker is a CPU-bound OrderSupplement projection during backlog recovery.

## Context and Orientation

`apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts` downloads each matching Gmail attachment, ingests it, runs dashboard-specific post-processing, and only then marks and trashes the successful Gmail message. A single `GmailImportOrchestrator` serializes all Gmail CSV schedules, so long post-processing blocks unrelated imports.

For dashboard ID `8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31`, `apps/api/src/services/csv-dashboard/csv-dashboard-post-ingest.service.ts` calls `ProductionScheduleOrderSupplementSyncService`. That service delegates to `resolveWinnerIdByKey` in `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts`.

A “winner” is the retained main production-schedule row for one logical manufacturing key. The canonical winner condition is generated by `apps/api/src/services/production-schedule/row-resolver/max-product-no-sql.ts` and must not change. The slow query supplies more than one hundred thousand supplemental triples through `jsonb_to_recordset`, joins them to main schedule JSON fields, and then applies the canonical winner condition.

Production already has canonical winner materialization helpers in `apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-materialization.ts`. They rank one dashboard with `ROW_NUMBER()` using the exact logical-key partition and winner order shared by the correlated predicate. The optimized OrderSupplement query uses those same helper-generated SQL expressions directly.

## Plan of Work

First capture a read-only `EXPLAIN` for the current and proposed predicates. A repeated normalized-index lookup is only acceptable if the bounded benchmark proves it releases the shared cycle quickly. If it still scales with the supplemental-key count, rank the main production schedule once with the existing canonical partition and ordering helpers, materialize those winners, and join the input keys to that result.

Add a focused SQL contract test near the existing OrderSupplement tests. It must assert that the main rows are ranked once with `ROW_NUMBER()`, the shared logical-key partition, and the shared winner ordering. Existing integration tests must continue to prove that only exact triples map and that the maximum-ProductNo winner is selected.

Change `resolveWinnerIdByKey` in `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts` without changing the winner rule. In the same pipeline, bound accumulated source history using a one-year business-date rule guarded by absence of a current exact-key winner. Do not add or change columns or dashboard definitions. Run retention only after successful replacement, in bounded chunks, and do not let cleanup failure fail the Gmail import.

Record the incident facts and prevention in one knowledge-base document or extend an existing directly relevant one, then add only a short index link if necessary.

After local validation, use the repository’s standard feature branch and PR flow. Deployment is authorized as part of restoring normal operation. The immutable merged main SHA must have successful CI. Run the standard deployment entry point with `--print-plan`, release-readiness preflight, and a Pi5-only limit because the change affects only the server API.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Capture plans without executing the expensive query:

    ssh denkon5sd02@100.106.158.2 "docker exec docker-db-1 psql ... -c 'EXPLAIN ...'"

Run focused tests after adding the regression:

    npm --prefix apps/api test -- --run apps/api/src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts

Run the repository-prescribed API validation commands discovered from `package.json` and CI workflow, then:

    git diff --check
    git status --short

After PR merge and exact-SHA CI success:

    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --print-plan
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --preflight-only
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5

Use the returned run ID with:

    scripts/update-all-clients.sh --status <runId>

## Validation and Acceptance

The focused SQL contract and OrderSupplement integration tests pass without changing expected winner mappings. Retention tests prove an old unmatched source row is deleted while an equally old row that still matches the current schedule is retained. CI passes on the exact merged SHA.

In a production read-only plan, the lookup ranks the main schedule once rather than applying the correlated winner subquery for every supplemental key. A bounded read-only or disposable-database benchmark completes materially faster than the observed multi-minute query and returns the expected winner IDs.

After deployment, the API and gateway health checks return OK. An OrderSupplement scheduled cycle reaches `Scheduled CSV import completed`; the next non-colliding Gmail schedule starts and completes without `Cycle skipped because previous cycle is running`. PostgreSQL does not remain saturated for minutes by `WITH input_keys AS`.

The BOM-only MeasuringInstrumentLoans messages are disposed as invalid input and no longer block the scheduler. A future valid MeasuringInstrumentLoans CSV continues to use the unchanged production column definition.

## Idempotence and Recovery

Read-only SQL inspection, tests, plan printing, and preflight can be repeated. The change introduces no data migration. Source retention is idempotent, restricted to the fixed OrderSupplement dashboard, and deletes only old unmatched IDs identified from the same successful lookup. If validation differs, stop before deployment and keep the old behavior.

The standard Pi5 Blue/Green deployment retains the previous slot. If production validation fails, use the documented deployment rollback path and status tooling; do not kill processes, delete locks, edit fleet state, or mutate the database over SSH.

## Artifacts and Notes

Key observed production evidence:

    MeasuringInstrumentLoans failed attachment sizes: 3 bytes each
    Attachment bytes: ef bb bf
    Main production rows: 59141
    OrderSupplement source rows: 111975
    Slow query: WITH input_keys AS (...) using jsonb_to_recordset
    Observed query age before mitigation: > 00:22:00
    06:30Z: MeasuringInstrumentLoans and RiggingSlingsInspection both skipped
    Disposable DB old query: statement timeout at 15.002s
    Disposable DB new query: 20,000 winners in 420.180ms
    Production source rows older than rolling one year by business date: 3,728
    Focused unit: 18 passed
    Disposable PostgreSQL integration: 4 passed

## Interfaces and Dependencies

Keep the public signature unchanged:

    export async function resolveWinnerIdByKey(
      client: PrismaClient,
      dedupedRows: SupplementNormalizedRow[]
    ): Promise<Map<string, string>>

Use Prisma’s parameterized SQL facilities and the canonical `buildMaxProductNoLogicalKeyPartitionExprs` / `buildMaxProductNoWinnerSelectionOrderBySql` helpers. Source deletion uses Prisma `deleteMany` with fixed dashboard scope and chunks of at most 2,000 IDs. No new runtime dependency is needed.

Revision note (2026-07-25 06:32Z): created after production evidence showed the recovered Gmail scheduler was being blocked by a separate CPU-bound OrderSupplement winner lookup.

Revision note (2026-07-25 06:49Z): recorded the rejected repeated-index approach, the canonical one-pass winner materialization decision, focused test results, and full-scale disposable-database benchmark.

Revision note (2026-07-25 07:11Z): added the production retention audit, guarded one-year source-row cleanup, completion of the old in-flight query, and refreshed focused validation evidence.

Revision note (2026-07-25 07:14Z): recorded commit `3333373c` and draft PR #1084.
