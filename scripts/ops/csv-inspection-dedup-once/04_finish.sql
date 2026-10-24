-- 03_delete.sql が done まで進んだ後に流す。
-- 1) 残った行（各キー1行）に dataHash を入れ、以後の取り込み（DEDUP）で同じ点検を弾けるようにする
-- 2) 表を1回だけ VACUUM して、消した行の場所を再利用できるようにする
-- 3) 作業表を消す
\set ON_ERROR_STOP on
\set dashboard_id '7d193f27-52f2-4c5f-be96-071a7208ac4a'
\timing on

-- 全部消し終わっていること。
SELECT (SELECT next_ord FROM "_ops_inspection_dedup_state") > (SELECT max(ord) FROM "_ops_inspection_dedup_losers") AS all_deleted \gset
\if :all_deleted
\else
  \echo '03_delete.sql has not finished; stop.'
  \quit
\endif

BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

-- calculateDataHash(row, dedupKeyColumns) と同じ式（01_check.sql で一致を確認済み）。
UPDATE "CsvDashboardRow" r
SET "dataHash" = encode(sha256(convert_to(concat_ws('|',
      lower(btrim(r."rowData"->>'equipmentManagementNumber')),
      lower(btrim(r."rowData"->>'inspectionItem')),
      lower(btrim(r."rowData"->>'inspectionAt'))), 'UTF8')), 'hex')
WHERE r."csvDashboardId" = :'dashboard_id'
  AND r."dataHash" IS NULL
  AND r."createdAt" <= (SELECT cutoff FROM "_ops_inspection_dedup_state");

-- 各キー1行になっていること（cutoff 後に入った行を除く）。
SELECT count(*) > 0 AS duplicated_keys
FROM (
  SELECT 1
  FROM "CsvDashboardRow"
  WHERE "csvDashboardId" = :'dashboard_id'
    AND "createdAt" <= (SELECT cutoff FROM "_ops_inspection_dedup_state")
  GROUP BY COALESCE("rowData"->>'equipmentManagementNumber', ''),
           COALESCE("rowData"->>'inspectionItem', ''),
           COALESCE("rowData"->>'inspectionAt', '')
  HAVING count(*) > 1
) d \gset
\if :duplicated_keys
  \echo 'duplicated keys remain; rolling back the dataHash update.'
  ROLLBACK;
  \quit
\endif
COMMIT;

-- 業務時間でも流せるよう、自動 VACUUM と同程度に読み書きの速さを抑える（並列も使わない）。
SET statement_timeout = 0;
SET vacuum_cost_delay = '2ms';
SET vacuum_cost_limit = 1000;
-- 末尾の空ページを切り詰めると表全体を止める鍵を取るので、切り詰めはしない（空きは再利用される）。
VACUUM (ANALYZE, VERBOSE, PARALLEL 0, TRUNCATE FALSE) "CsvDashboardRow";

SET lock_timeout = '60s';
ALTER TABLE "CsvDashboardRow" RESET (autovacuum_enabled);

SELECT count(*) AS rows_now,
       count(*) FILTER (WHERE "dataHash" IS NULL) AS null_hash
FROM "CsvDashboardRow" WHERE "csvDashboardId" = :'dashboard_id';

DROP TABLE "_ops_inspection_dedup_losers";
DROP TABLE "_ops_inspection_dedup_state";

SELECT pg_size_pretty(pg_total_relation_size('"CsvDashboardRow"')) AS total,
       pg_size_pretty(pg_indexes_size('"CsvDashboardRow"')) AS indexes;
