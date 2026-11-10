# KB-435: Power BI query 15MB response limit truncated production schedule CSVs

- Status: active; split imports restored the missing rows; daily scheduling remains open
- Scope: Power Automate → Gmail CSV → `ProductionSchedule_Mishima_Grinding` → mobile slip matching
- Date: 2026-11-02

## Context

On 2026-11-02, the mobile placement screen 「照合の記録」 on
`aquos-sense4-lite` showed 「未登録」 (`transfer_not_found`) for:

| 移動票 | 現品票 | Missing seiban |
|---|---|---|
| `0004078639` | `0005997139` | `BE1SB309` |
| `0004109731` | `0006033764` | `BE1SB316` |

`verifySlipMatch` could not find the transfer order number in the production
schedule's `CsvDashboardRow` records. The affected dashboard is
`ProductionSchedule_Mishima_Grinding` (`3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01`),
with Gmail subject 「生産日程_三島_研削工程」 and ingest mode `DEDUP`.

## Symptoms Or Trigger

- On 2026-10-29, resource `MSZ` (三島製造課) was added to the query's
  `FSIGENCD` list, adding about 9,500 rows. Every subsequent CSV ended mid-way
  through seiban order, although the Power Automate flow reported no error.
- The 10/28 CSV had 41,514 lines, was 3.6MB, and ended at `ZJ9LAM01` (complete).
  Later files plateaued at about 4.3–4.38MB; the 11/02 CSV had 50,439 lines
  and ended at `BA1S9324`.
- Later prefixes (`BA1T`, `BE1S`, `BN1S`, `RC1S`, …) were absent, including
  `BE1SB309` and `BE1SB316` for the two affected orders.

## Investigation

The source flow 「Gmail_csv出力_生産日程_三島_切削研削工程Direct」 runs daily
at 6:22 JST. Its action 「データセットに対してクエリを実行する」 uses the
Power BI connector `ExecuteDatasetQuery`:

- DAX `SUMMARIZECOLUMNS` returns eight columns, with `FSTTYOTEIYMD` between
  `EDATE(TODAY(),-3)` and `EDATE(TODAY(),6)`, seiban length 8, and an
  `FSIGENCD` allow-list.
- Results are ordered by `FSEIBAN`, `FSEZONO`, `FKOJUN`, `FSIGENCD`, then
  processed by 「選択」 → 「CSV テーブルの作成」 → mail with a CSV attachment.
- A `COUNTROWS` version of the same DAX returned **53,991** rows, while the
  flow received **50,610**: **3,381 missing (6.3%)**. This is a query-response
  count comparison, separate from the CSV line counts above.
- Neither the 100,000-row limit nor the 1,000,000-value limit was reached.
- Ingestion did not drop these rows. Deletion only removes rows older than
  one year and duplicates.
- Power BI Desktop returned the rows with a narrowed filter, explaining why
  Desktop appeared healthy while the full flow output was incomplete.
- The user reported a similar incident in late September 2026: an `FKOJUNST`
  status query hit the same limit and was split into 60-day `FUPDTEDT` windows.
  No separate KB exists for that incident.

## Root Cause

The Power BI `executeQueries` **15MB response limit** silently dropped rows
beyond the response budget. JSON repeats long column keys such as
`scaw STSIGENSHOYORYO[FSEZONO]` for every row, so a roughly 4.3MB CSV can
correspond to about 15MB of JSON. Adding `MSZ` pushed the query over that limit;
the sort order made later seiban prefixes disappear consistently.

## Fix

On 2026-11-02, the user split the Power Automate query by `FSTTYOTEIYMD`
into contiguous `EDATE` periods covering **-6..6 months** (for example
-6..-3, -3..0, 0..3, 3..6). Each part has its own query and mail using the
same subject 「生産日程_三島_研削工程」.

- Five CSVs arrived at 16:07–16:13 JST that day, each with 14,895–20,862 lines;
  all were imported.
- Rows for `0004078639` and `0004109731` (`FKOJUN` 450/460, `MSZ`) are now
  present in the DB.
- Existing 「未登録」 match records do not change automatically. The floor
  must re-scan the two matches.

## Prevention

Watch for file sizes stuck near the same value each day despite expected
growth, a sorted export ending before the alphabet's end, or missing IDs
concentrated in later keys. Check the source response before blaming ingestion.

Read-only inspection on the host (find the active API container first):

```sh
docker ps --format '{{.Names}}\t{{.Status}}'
# Set this to the active bluegreen-api-blue-1 or bluegreen-api-green-1.
API_CONTAINER=bluegreen-api-blue-1
docker exec "$API_CONTAINER" sh -c '
  for f in /app/storage/csv-dashboards/3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01/raw/2026/11/*.csv; do
    [ -f "$f" ] || continue
    printf "%s\n" "$f"
    wc -c -l < "$f"
  done
'
```

Use `/app/storage/csv-dashboards/<dashboardId>/raw/YYYY/MM/*.csv` for other
dashboards/months. `wc` reports lines and bytes; line counts include the header
and are not necessarily query row counts.

Compare `COUNTROWS` for the same DAX filters with the flow's received count:

```text
length(outputs('データセットに対してクエリを実行する')?['body/firstTableRows'])
```

- As a rough budget for eight-column output, keep each query's CSV **well
  under ~4MB**. This is a heuristic, not a CSV limit; fewer/shorter columns
  allow more rows. Split by period or key before approaching the budget.
- Gmail import reads up to ten unread matching messages per run by default
  (`GMAIL_MAX_MESSAGES_PER_BATCH=10`, `downloadAllWithMetadata`), including
  multiple mails with the same subject. Keep the split batch within that
  budget and have all parts arrive before the daily import around **7:08 JST**.
- `DEDUP` keeps existing rows and upserts by logical key. Overlapping periods
  are harmless; gaps omit rows from the incoming data. Preserve full coverage.

## Validation

Incident evidence verified on 2026-11-02: all five split CSVs imported, and both
transfer orders' schedule rows were present in the DB. Re-scanning remains open.
The inspection commands above are a future runbook, not commands run for this KB.

Other CSV dashboards checked that day showed no truncation:

| Dashboard | Evidence |
|---|---|
| `FKOJUNST_Status` | ~40k rows, 5 columns, 1.8MB; 6-day `FUPDTEDT` window; oldest-day count stable (7,266 → 7,262) |
| `PurchaseOrder_FKOBAINO` | ~14.5k rows |
| `ProductionSchedule_OrderSupplement` | ~25.5k rows, 1.6MB |
| `ScawStFutekigo` | 6,844 records, 3.65MB; slow natural growth; newest record 10/29 |
| Small exports | 計測機器持出状況, 加工機日常点検結果, slings inspection, `FHINMEI_MH_SH` were fine |

`CustomerSCAW` had no stored CSV, so its stored output could not be assessed.

## Open Items

- Make the split flows the daily scheduled flows and turn off the old single flow.
- Re-scan the two matches on the floor.
- Consider an importer warning for a sharp row-count drop or size plateau;
  this is an idea only and is not implemented.

## References

- [`verifySlipMatch`](../../packages/slip-match-core/src/verify.ts)
- [Gmail storage provider (`downloadAllWithMetadata`)](../../apps/api/src/services/backup/storage/gmail-storage.provider.ts)
- Power Automate flow: 「Gmail_csv出力_生産日程_三島_切削研削工程Direct」;
  action: 「データセットに対してクエリを実行する」.
- Evidence: 2026-11-02 query-count comparison, CSV history, split-mail arrivals,
  and DB row confirmation supplied during the incident investigation.
