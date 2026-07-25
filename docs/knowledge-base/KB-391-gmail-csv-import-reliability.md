# KB-391: Gmail CSV import reliability (FKOJUNST advisory lock + schedule collision warnings)

## Metadata

| Field | Value |
|-------|-------|
| id | KB-391 |
| status | active |
| scope | Gmail csvDashboards scheduled import, assembly DocumentASM manual import, FKOJUNST_Status mail ingest, OrderSupplement projection, admin CSV import schedule UI |
| date | 2026-07-25 |
| source_of_truth | this file |
| related_code | `gmail-request-serializer.ts`, `gmail-subject-reservation.policy.ts`, `assembly-procedure-gmail-import.service.ts`, `csv-import-scheduler.ts`, `fkojunst-status-mail-critical-lock.ts`, `fkojunst-status-mail-ingest-publication.ts`, `import-schedule-policy.ts`, `CsvImportSchedulePage.tsx`, `csv-dashboard-ingestor.ts`, `gmail-api-client.ts`, `order-supplement-sync.pipeline.ts` |
| related_docs | [Gmail conflict guard plan](../plans/gmail-import-conflict-guards-20260725.md), [csv-import-export.md](../guides/csv-import-export.md), [deployment.md](../guides/deployment.md) |

## Context

Some Gmail csvDashboards CSV imports were skipped or failed silently in production:

1. **`FKOJUNST_Status` ingest** failed with Prisma `Failed to deserialize column of type 'void'` because `pg_advisory_xact_lock` was called via `$queryRaw` (void return).
2. **Schedule collisions** between enabled Gmail csvDashboards jobs caused later runs to be skipped by `GmailImportOrchestrator` without import history.
3. **Admin visibility** for collision risk was insufficient (minute-only detection; warnings not shown on list/create/update).

## DocumentASM concurrency and subject-reservation follow-up (2026-07-25)

### Risk

The operator-triggered assembly procedure importer and the scheduled CSV
importer shared credentials and cooldown state but had no common operation
guard. Distinct current subject patterns prevented the same message from being
consumed, but simultaneous Gmail API calls could increase rate-limit pressure.
A future CSV pattern such as `ASM` could also match and dispose a
`DocumentASM` procedure email before the assembly flow saw it.

### Prevention

- `DocumentASM` is the one canonical reserved subject. CSV pattern create and
  update paths reject exact, case/space variants, and any substring that could
  match it. The Gmail storage provider repeats the check before
  `messages.list`, covering old or directly edited settings without touching
  the mailbox.
- `CsvImportScheduler` exposes only whether an effective Gmail CSV execution is
  active. Assembly import returns HTTP 409 before client creation when it is
  active.
- Individual Gmail API calls use one process-wide FIFO serializer. A queued
  request rechecks cooldown after admission; 429 cooldown persistence completes
  before the next request, while cooldown sleep happens outside the exclusive
  slot.
- No schema migration or production Gmail/config mutation is required.

Implementation and validation evidence are maintained in
[the ExecPlan](../plans/gmail-import-conflict-guards-20260725.md).

### Production validation

- PR [#1086](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1086) passed required
  CI, CodeQL, and secret scanning and was squash-merged as
  `d5a58bc4885b3e8bca02d0a53c4eef3e6b448dbe`.
- Exact-SHA `--print-plan` and read-only preflight passed before standard Pi5 Blue/Green
  run `20260725-110632-e1e6ea`. API/Web release claims were verified at the merged SHA,
  API health was `ok`, and the final same-SHA plan selected no targets.
- The active API held the scheduler leader lock once and started the CSV scheduler once.
  Gmail cooldown was `NORMAL`, CSV `PROCESSING` history count was zero, and the new
  container logged no skipped Gmail cycles or new Gmail rate-limit cooldown.
- Post-deploy scheduled imports completed normally:
  `MeasuringInstrumentLoans` completed from 11:15:00Z to 11:15:14Z, followed by the
  machine-inspection import from 11:21:00Z to 11:21:16Z.
- Phase12 passed **47 / 0 / 0**. No production Gmail message or CSV subject setting was
  created or changed for this validation.

## Gmail transport hang follow-up (2026-07-25)

### Symptoms Or Trigger

- Pi5 production stopped processing all scheduled Gmail CSV imports after `MeasuringInstrumentLoans`.
- API logs showed `Starting Gmail import cycle` and `Starting scheduled CSV import`, but no Gmail search completion or failure.
- The import-history watchdog changed stale `PROCESSING` rows to `FAILED`, while the in-process `GmailImportOrchestrator.running` lock remained held.
- Restarting only the active API container cleared the lock, but the next `MeasuringInstrumentLoans` run hung again.

### Investigation And Root Cause

- PostgreSQL had no long-running active query for the import.
- The API network namespace had Google TCP/443 connections stalled for more than 30 minutes after sending only a few hundred bytes.
- Pi5 HTTPS probes to the eight current `gmail.googleapis.com` IPv4 answers were deterministic during the check: four reached Gmail and returned HTTP 404, while four timed out. The same eight addresses were all reachable from the operator Mac.
- This establishes a Pi5/upstream path failure to part of the Google frontend address set. The exact router/ISP fault remains outside the application evidence.
- `GmailApiClient` passed `retry: false` but no request timeout to `googleapis`/`gaxios`. A stalled TCP/TLS request therefore never settled, so the orchestrator's `finally` block could not release its lock.

### Fix And Validation

- `GmailApiClient` now applies `GMAIL_API_REQUEST_TIMEOUT_MS` to every Gmail API call, defaulting to 30 seconds.
- Installed `gaxios 7.1.3` converts this option to `AbortSignal.timeout()`.
- Validation: Gmail client/orchestrator tests **26 passed**, API TypeScript build passed, targeted ESLint passed, and `git diff --check` passed.
- The fix from PR **#1076** was included in immutable main SHA **`01ff7e46d056e2155eae8f19a11db21d75244f37`** and deployed to Pi5 by standard run **`20260725-052801-50f15e`**. The 15:15 MeasuringInstrumentLoans cycle released the lock and the 15:21 machine-inspection cycle completed.

## OrderSupplement backlog projection follow-up (2026-07-25)

### Symptoms Or Trigger

- After the Gmail request-timeout fix and router restart restored downloads, `ProductionSchedule_OrderSupplement` ingested one 22,843-row message but remained inside post-ingest projection.
- PostgreSQL stayed near 100% CPU on `resolveWinnerIdByKey()` for more than 22 minutes.
- The shared `GmailImportOrchestrator` lock caused the 15:30 MeasuringInstrumentLoans and rigging jobs, the 15:36 machine-inspection job, and later jobs to skip.

### Investigation And Root Cause

- Production contained 59,141 main production-schedule rows and 111,975 accumulated OrderSupplement source rows.
- The old query passed every supplemental triple through `jsonb_to_recordset`, joined candidate rows, and evaluated the correlated maximum-ProductNo winner subquery repeatedly.
- A normalized expression-index variant still exceeded a bounded 30-second probe under production load, so changing only the candidate predicate did not remove the cardinality multiplier.
- The ten queued MeasuringInstrumentLoans attachments were a separate upstream-input condition: every saved file was exactly three bytes and contained only UTF-8 BOM bytes. Adding a header alias would not make those files valid.

### Fix And Validation

- `resolveWinnerIdByKey()` now ranks the main production rows once with `ROW_NUMBER()`, using the existing canonical logical-key partition and maximum-ProductNo ordering helpers, then joins supplemental keys to the materialized winners.
- The data model, Gmail behavior, and winner rule are unchanged; no migration is required.
- Existing generic retention did not enforce a rolling year for this source: all 111,975 source rows had import timestamps from April–July 2026 even though their planned business dates span 2025–2027.
- After a successful supplement sync, source rows are now pruned only when the planned end date (falling back to planned start date) is older than one rolling year **and** the exact key has no current production-schedule winner. Current long-running work, future/recent work, and unknown-date rows are retained. Cleanup is dashboard-scoped, chunked, and warning-only so it cannot block Gmail throughput.
- Focused unit tests pass, including a SQL-shape contract that prevents reintroducing per-key winner evaluation.
- Disposable PostgreSQL integration proves that only the maximum-ProductNo row of a duplicate logical key receives the supplement and that old unmatched source data is deleted while an old current-key row is retained.
- At production-scale synthetic cardinality (59,141 main rows and 111,975 supplemental keys), the old query exceeded a 15-second timeout; the new query returned the expected 20,000 winners in 420.180 ms.
- Production had 3,728 source rows eligible by business date before applying the current-winner protection.
- The old 15:24 JST in-flight cycle eventually completed at 15:56 JST; the 16:00 rigging cycle then started, confirming that the shared lock released without forced termination.
- PR [#1084](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1084) passed required CI and was squash-merged as immutable main SHA `e59db98c6218f7e3bf927589231a0ec13b0b0ac7`.
- Exact-SHA `--print-plan` and `--preflight-only` passed before standard Pi5-only deployment run `20260725-073820-042768`. API/Web release claims were verified and health returned HTTP 200.
- A production read-only execution of the new winner query over all 111,975 source rows returned 27,687 winners in 3.177 seconds. The deployed 16:54 and 17:24 OrderSupplement schedules had no matching unread message and completed in 1.301 and 1.326 seconds, so the next non-empty cycle remains the final end-to-end source-retention observation.
- Later schedules completed instead of being blocked: 17:00 rigging processed ten messages in 51.558 seconds, 17:15 MeasuringInstrumentLoans disposed ten invalid BOM-only messages in 45.026 seconds, and 17:21 machine inspection imported ten messages / 1,840 rows in 52.441 seconds. All reported zero failed messages.
- Final production checks showed API health 200, zero `CsvImportHistory` rows in `PROCESSING`, zero last-hour `CsvDashboardIngestRun` rows in `PROCESSING`, and zero database queries active for more than five seconds.

## Symptoms Or Trigger

- `FKOJUNST_Status` Gmail CSV not reflected in production schedule / mail status tables after scheduled or manual import.
- API logs / import history show Prisma **P2010** or `deserialize column of type 'void'` around advisory lock SQL.
- Multiple enabled Gmail csvDashboards schedules fire at the same minute/hour/day-of-week; only the first completes, others skip with no history row.
- Admin **CSV取込** tab does not show collision warnings until after save (or not at all on list).

## Root Cause

1. **Advisory lock API misuse**: `pg_advisory_xact_lock` returns void; Prisma `$queryRaw` expects row-shaped results → P2010.
2. **Weak collision detection**: prior policy compared cron minute field strings only; missed overlaps like `15,30,45 * * * *` vs `15 6 * * 0`.
3. **Warning propagation gap**: `GET /imports/schedule` wrapped `listSchedules()` and dropped `warnings`; UI had no list/save warning surface.

## Fix

| Area | Change |
|------|--------|
| Advisory lock | Shared helper `acquireFkojunstStatusMailCriticalTransactionLock()` using `$executeRaw`; used from `csv-dashboard-ingestor` and `fkojunst-status-mail-sync.pipeline` |
| Collision policy | `expandGmailScheduleTriggerKeys()` (minute/hour/dayOfWeek intersection); indeterminate cron shapes emit warning-only |
| Admin API/UI | `listSchedules()` returns `{ schedules, warnings }`; CSV取込 tab shows warnings on list/create/update |
| Non-prod defaults | `FHINMEI_MH_SH` default cron `15 6 * * 0` → `18 6 * * 0` in builtin rows / `defaultBackupConfig` only (**production `backup.json` not auto-mutated**) |
| FKOJUNST completion timeout (2026-06-18) | Locked completion tx applies deferred row content + source publication atomically via batched `UPDATE ... FROM (VALUES ...)` (`fkojunst-status-mail-ingest-publication.ts`); no pre-completion row writes |

**Branch**: `fix/gmail-csv-import-reliability` · **squash on `main`**: **`5ec5cee1`** · **CI**: run `27659565498` success (Trivy image api once failed on runner disk; `--failed` rerun succeeded).

## FKOJUNST completion timeout follow-up (2026-06-18)

### Symptoms Or Trigger

- `FKOJUNST_Status` Gmail CSV reaches ingest but fails with Prisma **P2028** / **`Transaction already closed`** during completion.
- Import history shows `FAILED` ingest runs with large `rowsProcessed`; Gmail message stays in INBOX (post-ingest does not run).
- Some failed runs leave existing rows with `sourceIngestRunId` pointing at the failed run → `fetchFkojunstStatusMailSourceRowsOrdered` hides them (requires `COMPLETED` source run).

### Root Cause

After KB-391 advisory lock fix, the completion transaction still ran **all deferred existing-row updates** (including large `rowData` JSON) inside a **60s interactive transaction** using **`Promise.all` over 500-row chunks**. Pi5 production ingest (~5k+ metadata refresh updates per daily CSV) exceeded the timeout.

### Fix

| Step | Behavior |
|------|----------|
| Deferred staging | Existing-row updates stay in memory until completion; no DB writes before the locked completion tx |
| Completion phase | `applyFkojunstDeferredRowUpdatesInTransaction()` — advisory lock, then batched `UPDATE ... FROM (VALUES ...)` for `rowData` / `occurredAt` / source metadata, then ingest run `COMPLETED` |
| Reader invariant | Failed completion rolls back row changes; reader-visible rows keep prior COMPLETED content and source metadata |
| Retry | Same Gmail message / CSV can be reprocessed after failure |

**Branch (implementation)**: `fix/fkojunst-status-gmail-timeout` · **commit** **`959c3dd8`** · **CI** run **`27733856447`** success.

### Validation

- `fkojunst-status-mail-ingest-publication.test.ts`
- `csv-dashboard-ingestor-fkojunst-completion.test.ts`
- `import-schedule-policy.test.ts` (`18 6 * * 0` does not collide with `15,30,45 * * * *`)
- Temp Postgres: 5,000-row batch update ~320ms; EXPLAIN uses `CsvDashboardRow_pkey` (no `text = uuid` cast)

## Prevention

- Unit tests: `fkojunst-status-mail-critical-lock.test.ts`, `import-schedule-policy.test.ts`, `fkojunst-status-mail-ingest-publication.test.ts`, `csv-dashboard-ingestor-fkojunst-completion.test.ts`
- Integration: `imports-schedule.integration.test.ts` (collision warnings + `config.storage.provider` reset in `beforeEach`)
- DB proof: temp Postgres — `$executeRaw` lock OK; `$queryRaw` on same SQL reproduces P2010

## Production Deploy And Verification

### KB-391 advisory lock + collision warnings (2026-06-17)

| Item | Value |
|------|-------|
| Target host | **`raspberrypi5` only** (Pi4×4 / Pi3 / Zero2W **not required**) |
| Branch | `fix/gmail-csv-import-reliability` · squash on **`main`**: **`5ec5cee1`** ([PR #452](https://github.com/denkoushi/RaspberryPiSystem_002/pull/452)) |
| Command | `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` then `./scripts/update-all-clients.sh fix/gmail-csv-import-reliability infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow` |
| Detach Run ID | **`20260617-105312-14779`** |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` |
| Docker | `Git: changed` · **api + web rebuild** |
| Migration | **none** |
| Phase12 | `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0** (~45s, tailscale) |

### FKOJUNST completion timeout fix (2026-06-18)

| Item | Value |
|------|-------|
| Target host | **`raspberrypi5` only** |
| Branch | **`fix/fkojunst-status-gmail-timeout`** · **`959c3dd8`** |
| Command | `./scripts/update-all-clients.sh fix/fkojunst-status-gmail-timeout infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow` |
| Detach Run ID | **`20260618-122644-13251`** |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` · Pi4/Pi3 **no hosts matched** |
| Docker | `Git: changed` · **api rebuild** (publication module present on Pi5) |
| Migration | **none** |
| Phase12 | `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0** (~65s) |
| Manual FKOJUNST import | Admin `POST /api/imports/schedule/csv-import-productionschedule-fkojunst-status-mail/run` with `{}` body |

**Agent/API curl verification (2026-06-18, pre-admin UI)**:

| Check | Result |
|-------|--------|
| Prior failure pattern | `CsvDashboardIngestRun` **FAILED** with `csvDashboardRow.update()` P2028 / 60s tx (2026-06-17) |
| Publication helper | API log `[FkojunstStatusMailIngestPublication] deferred row updates completed` — **79,550 rows** (~105s) and **79,555 rows** (~72s) |
| Post-ingest (early) | 1st curl-triggered message: `createMany()` **60s tx timeout** once; later messages recovered |

### Admin console manual verification (2026-06-18)

Operator ran manual imports from admin **CSV取込** UI (Pi5 production).

| Schedule ID | `CsvImportHistory` | Status | Window (UTC) | Rows / outcome |
|-------------|-------------------|--------|----------------|----------------|
| `csv-import-seiban-machine-name-supplement` | `b219362f-f45c-4275-9dd1-06b083297561` | **COMPLETED** | 04:06:33 → 04:06:42 | **2,793** rows · `postProcessState=completed` |
| `csv-import-productionschedule-fkojunst-status-mail` | `fe2d463a-7be5-4078-913a-b8d6ae4c6698` | **COMPLETED** | 04:07:32 → 04:12:31 (~5 min) | **159,105** rows total (**2** Gmail messages: **79,550** + **79,555**) |

**FKOJUNST_Status detail**:

| Check | Result |
|-------|--------|
| Ingest runs | `8421cc7a` / `3fb4f91e` — both **`COMPLETED`**, no `csvDashboardRow.update` P2028 |
| Post-ingest | Both messages **`postProcessState=completed`** (mail-status sync OK) |
| API log | `[CsvImportScheduler] Manual CSV import completed` · `[CSV Import Schedule] Manual import completed` |
| Gmail debug | `postProcessedMessageIdSuffixes`: `961ca1`, `d9138f` — both **completed**, **0** failed |
| Operator cron edit | Before run, admin **PUT** changed FKOJUNST cron **`43 4 * * *` → `43 6 * * *`** (stored in production `backup.json`) |

**Resume context for next AI**: Ingest completion fix (**`e111dda3`**) and end-to-end admin manual run are **verified on Pi5**. Monitor the **scheduled** job at the new cron **`43 6 * * *`** for parity with manual success.

## Post-Deploy Operator Actions (if symptoms persist)

Per [csv-import-export.md §Gmail csvDashboards スケジュール衝突](../guides/csv-import-export.md):

1. Open admin **CSV取込** tab; read `warnings` from schedule list/save responses.
2. If schedules collide, shift cron (e.g. `FHINMEI_MH_SH`: `18 6 * * 0` or `20 6 * * 0`) — **edit production `backup.json` via admin, not code defaults**.
3. Manual re-import on Pi5 admin or API:
   - `csv-import-productionschedule-fkojunst-status-mail` (FKOJUNST_Status lock fix)
   - `csv-import-seiban-machine-name-supplement` (FHINMEI_MH_SH backlog)

## Open Items

- [x] Deploy `fix/fkojunst-status-gmail-timeout` to Pi5 (Detach **`20260618-122644-13251`**).
- [x] Admin manual `csv-import-productionschedule-fkojunst-status-mail` — **COMPLETED** · 159,105 rows · post-ingest **completed** (history `fe2d463a`).
- [x] Admin manual `csv-import-seiban-machine-name-supplement` — **COMPLETED** · 2,793 rows (history `b219362f`).
- [ ] Confirm production admin shows collision warnings for current enabled Gmail schedules (operator visual check).
- [ ] Monitor next **scheduled** FKOJUNST_Status cycle at production cron **`43 6 * * *`** (operator-set; was `43 4 * * *`).
- [ ] If post-ingest `createMany` timeout recurs at ~80k rows, extend or batch `fkojunst-status-mail-sync.pipeline` (not observed on 2026-06-18 admin manual run).
- [x] Deploy the Gmail API request-timeout fix to Pi5 through the standard rolling workflow; the 15:15 MeasuringInstrumentLoans cycle released the shared lock and the 15:21 machine-inspection cycle completed.
- [x] Recover the common Pi5/Pi4 outbound path by restarting the router after read-only cross-device probes confirmed the same failure; release-readiness external probes then passed 27/27.
- [x] Deploy the OrderSupplement one-pass winner lookup and verify the backlog drains without later schedules being skipped (PR **#1084**, main **`e59db98c`**, run **`20260725-073820-042768`**).
- [ ] Observe the next non-empty OrderSupplement message and record `sourceRowsPruned`; no unread matching message was available in the two post-deploy scheduled cycles.
- [x] Deploy and production-validate the DocumentASM/CSV conflict guards (PR **#1086**,
  main **`d5a58bc`**, run **`20260725-110632-e1e6ea`**, Phase12 **47/0/0**).

## Local Notes JA

- 本番 `backup.json` の cron はコードデプロイでは自動変更しない。警告が出た場合のみ管理コンソールでずらす。
- Pi4 はキオスク SPA 正本だが、今回の変更は管理画面 + API バックエンドのみのため Pi5 デプロイで足りる。

## References

- Plan (KB-391): `.cursor/plans/gmail_csv_reliability_605d8671.plan.md` (Cursor workspace)
- Plan (completion timeout): `.cursor/plans/gmail_csv_recovery_f8ebbce7.plan.md` (Cursor workspace)
- PR: [#452](https://github.com/denkoushi/RaspberryPiSystem_002/pull/452) (squash merge **`5ec5cee1`**)
- PR: [#457](https://github.com/denkoushi/RaspberryPiSystem_002/pull/457) (squash merge **`e111dda3`**)
- PR: [#1084](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1084) (OrderSupplement one-pass lookup and guarded retention; squash merge **`e59db98c`**)
- PR: [#1086](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1086) (DocumentASM reservation, Gmail API FIFO, CSV-running assembly 409; squash merge **`d5a58bc`**)
