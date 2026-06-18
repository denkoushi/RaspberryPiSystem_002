# KB-391: Gmail CSV import reliability (FKOJUNST advisory lock + schedule collision warnings)

## Metadata

| Field | Value |
|-------|-------|
| id | KB-391 |
| status | active |
| scope | Gmail csvDashboards scheduled import, FKOJUNST_Status mail ingest, admin CSV import schedule UI |
| date | 2026-06-18 |
| source_of_truth | this file |
| related_code | `fkojunst-status-mail-critical-lock.ts`, `fkojunst-status-mail-ingest-publication.ts`, `import-schedule-policy.ts`, `CsvImportSchedulePage.tsx`, `csv-dashboard-ingestor.ts` |
| related_docs | [csv-import-export.md](../guides/csv-import-export.md), [deployment.md](../guides/deployment.md) |

## Context

Some Gmail csvDashboards CSV imports were skipped or failed silently in production:

1. **`FKOJUNST_Status` ingest** failed with Prisma `Failed to deserialize column of type 'void'` because `pg_advisory_xact_lock` was called via `$queryRaw` (void return).
2. **Schedule collisions** between enabled Gmail csvDashboards jobs caused later runs to be skipped by `GmailImportOrchestrator` without import history.
3. **Admin visibility** for collision risk was insufficient (minute-only detection; warnings not shown on list/create/update).

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

## Local Notes JA

- 本番 `backup.json` の cron はコードデプロイでは自動変更しない。警告が出た場合のみ管理コンソールでずらす。
- Pi4 はキオスク SPA 正本だが、今回の変更は管理画面 + API バックエンドのみのため Pi5 デプロイで足りる。

## References

- Plan (KB-391): `.cursor/plans/gmail_csv_reliability_605d8671.plan.md` (Cursor workspace)
- Plan (completion timeout): `.cursor/plans/gmail_csv_recovery_f8ebbce7.plan.md` (Cursor workspace)
- PR: [#452](https://github.com/denkoushi/RaspberryPiSystem_002/pull/452) (squash merge **`5ec5cee1`**)
- PR: [#457](https://github.com/denkoushi/RaspberryPiSystem_002/pull/457) (squash merge **`e111dda3`**)
