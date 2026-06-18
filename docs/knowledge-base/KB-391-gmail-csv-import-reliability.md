# KB-391: Gmail CSV import reliability (FKOJUNST advisory lock + schedule collision warnings)

## Metadata

| Field | Value |
|-------|-------|
| id | KB-391 |
| status | active |
| scope | Gmail csvDashboards scheduled import, FKOJUNST_Status mail ingest, admin CSV import schedule UI |
| date | 2026-06-17 |
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

**Branch (implementation)**: `fix/fkojunst-status-gmail-timeout`.

### Validation

- `fkojunst-status-mail-ingest-publication.test.ts`
- `csv-dashboard-ingestor-fkojunst-completion.test.ts`
- `import-schedule-policy.test.ts` (`18 6 * * 0` does not collide with `15,30,45 * * * *`)

## Prevention

- Unit tests: `fkojunst-status-mail-critical-lock.test.ts`, `import-schedule-policy.test.ts`, `fkojunst-status-mail-ingest-publication.test.ts`, `csv-dashboard-ingestor-fkojunst-completion.test.ts`
- Integration: `imports-schedule.integration.test.ts` (collision warnings + `config.storage.provider` reset in `beforeEach`)
- DB proof: temp Postgres — `$executeRaw` lock OK; `$queryRaw` on same SQL reproduces P2010

## Production Deploy And Verification (2026-06-17)

| Item | Value |
|------|-------|
| Target host | **`raspberrypi5` only** (Pi4×4 / Pi3 / Zero2W **not required**) |
| Command | `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` then `./scripts/update-all-clients.sh fix/gmail-csv-import-reliability infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow` |
| Detach Run ID | **`20260617-105312-14779`** |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` |
| Docker | `Git: changed` · **api + web rebuild** |
| Migration | **none** |
| Phase12 | `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0** (~45s, tailscale) |

## Post-Deploy Operator Actions (if symptoms persist)

Per [csv-import-export.md §Gmail csvDashboards スケジュール衝突](../guides/csv-import-export.md):

1. Open admin **CSV取込** tab; read `warnings` from schedule list/save responses.
2. If schedules collide, shift cron (e.g. `FHINMEI_MH_SH`: `18 6 * * 0` or `20 6 * * 0`) — **edit production `backup.json` via admin, not code defaults**.
3. Manual re-import on Pi5 admin or API:
   - `csv-import-productionschedule-fkojunst-status-mail` (FKOJUNST_Status lock fix)
   - `csv-import-seiban-machine-name-supplement` (FHINMEI_MH_SH backlog)

## Open Items

- [ ] Deploy `fix/fkojunst-status-gmail-timeout` to Pi5 and manually run `csv-import-productionschedule-fkojunst-status-mail`.
- [ ] Confirm production admin shows collision warnings for current enabled Gmail schedules (operator visual check).
- [ ] If collision warnings present for `FHINMEI_MH_SH`, adjust production cron to `18 6 * * 0` (or later) and run manual `csv-import-seiban-machine-name-supplement`.
- [ ] Monitor next scheduled Gmail cycle for previously failing dashboards (FKOJUNST_Status, FHINMEI_MH_SH).

## Local Notes JA

- 本番 `backup.json` の cron はコードデプロイでは自動変更しない。警告が出た場合のみ管理コンソールでずらす。
- Pi4 はキオスク SPA 正本だが、今回の変更は管理画面 + API バックエンドのみのため Pi5 デプロイで足りる。

## References

- Plan (implementation): `.cursor/plans/gmail_csv_reliability_605d8671.plan.md` (Cursor workspace)
- PR: [#452](https://github.com/denkoushi/RaspberryPiSystem_002/pull/452) (squash merge **`5ec5cee1`**)
