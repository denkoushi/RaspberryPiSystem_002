-- 加工機_日常点検結果の重複を1回で片付ける作業の事前確認（読み取りのみ）。
-- 実行: docker exec -i docker-db-1 psql -U postgres -d borrow_return -X < 01_check.sql
\set ON_ERROR_STOP on
\set dashboard_id '7d193f27-52f2-4c5f-be96-071a7208ac4a'

BEGIN READ ONLY;
SET LOCAL statement_timeout = '300s';
SET LOCAL work_mem = '64MB';

-- キーの数、重複の数、dataHash の有無。nightly 削除と同じキー定義（COALESCE(...,'')）を使う。
WITH k AS (
  SELECT
    COALESCE("rowData"->>'equipmentManagementNumber', '') AS a,
    COALESCE("rowData"->>'inspectionItem', '') AS b,
    COALESCE("rowData"->>'inspectionAt', '') AS c,
    count(*) AS n,
    bool_or("dataHash" IS NOT NULL) AS has_hashed
  FROM "CsvDashboardRow"
  WHERE "csvDashboardId" = :'dashboard_id'
  GROUP BY 1, 2, 3
)
SELECT count(*) AS keys, sum(n) AS rows, sum(n) - count(*) AS losers, max(n) AS max_dup,
       count(*) FILTER (WHERE has_hashed) AS keys_with_hash
FROM k;

-- SQL で作る dataHash がアプリ（calculateDataHash）と一致するか。0 件不一致であること。
SELECT count(*) AS hashed_rows,
       count(*) FILTER (WHERE "dataHash" <> encode(sha256(convert_to(concat_ws('|',
         lower(btrim("rowData"->>'equipmentManagementNumber')),
         lower(btrim("rowData"->>'inspectionItem')),
         lower(btrim("rowData"->>'inspectionAt'))), 'UTF8')), 'hex')) AS mismatched
FROM "CsvDashboardRow"
WHERE "csvDashboardId" = :'dashboard_id' AND "dataHash" IS NOT NULL;

-- この dashboard の行を参照する生産日程側の行。0 件であること（削除で連鎖削除されない）。
SELECT
  (SELECT count(*) FROM "ProductionScheduleOrderAssignment" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleRowNote" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleProgress" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleGlobalRowRank" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleOrderSupplement" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleFkojunstStatus" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleFkojunstMailStatus" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleExternalCompletion" t JOIN "CsvDashboardRow" r ON r.id = t."csvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  + (SELECT count(*) FROM "ProductionScheduleOrderSplit" t JOIN "CsvDashboardRow" r ON r.id = t."parentCsvDashboardRowId" WHERE r."csvDashboardId" = :'dashboard_id')
  AS referencing_rows;

-- 表と索引の大きさ、外部キーの数（9 であること。増えていたら上の確認を足す）。
SELECT pg_size_pretty(pg_total_relation_size('"CsvDashboardRow"')) AS total,
       pg_size_pretty(pg_relation_size('"CsvDashboardRow"')) AS heap,
       pg_size_pretty(pg_indexes_size('"CsvDashboardRow"')) AS indexes,
       (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = '"CsvDashboardRow"'::regclass) AS fk_count;

COMMIT;
