-- 消す行（各キーで nightly 削除と同じ順位の2番目以降）の ID を作業表に1回だけ書き出す。
-- 業務の行は変えない。作業表は 04_finish.sql で消す。DB が落ちても続きから再開できるよう、作業表は通常の（WAL に残る）表にする。
-- 並びは物理位置（ctid）順にして、削除で触るページを前から順に進める。
\set ON_ERROR_STOP on
\set dashboard_id '7d193f27-52f2-4c5f-be96-071a7208ac4a'
\timing on

BEGIN;
SET LOCAL statement_timeout = '600s';
SET LOCAL work_mem = '128MB';

CREATE TABLE "_ops_inspection_dedup_losers" (
  ord bigint PRIMARY KEY,
  id text NOT NULL
);

-- この時点より後に入った行は対象にしない（取り込みは止めずに作業する）。
CREATE TABLE "_ops_inspection_dedup_state" (
  cutoff timestamp NOT NULL,
  next_ord bigint NOT NULL DEFAULT 1,
  deleted bigint NOT NULL DEFAULT 0
);
INSERT INTO "_ops_inspection_dedup_state" (cutoff) VALUES (now() AT TIME ZONE 'UTC');

INSERT INTO "_ops_inspection_dedup_losers" (ord, id)
SELECT row_number() OVER (ORDER BY ctid), id
FROM (
  SELECT r.ctid, r.id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(r."rowData"->>'equipmentManagementNumber', ''),
                        COALESCE(r."rowData"->>'inspectionItem', ''),
                        COALESCE(r."rowData"->>'inspectionAt', '')
           ORDER BY r."createdAt" DESC, r.id DESC
         ) AS rn
  FROM "CsvDashboardRow" r
  WHERE r."csvDashboardId" = :'dashboard_id'
    AND r."createdAt" <= (SELECT cutoff FROM "_ops_inspection_dedup_state")
) ranked
WHERE rn > 1;

ANALYZE "_ops_inspection_dedup_losers";

SELECT cutoff, (SELECT count(*) FROM "_ops_inspection_dedup_losers") AS losers
FROM "_ops_inspection_dedup_state";

COMMIT;

-- 削除の間は自動 VACUUM を止め、04_finish.sql でまとめて1回だけ流す（削除と VACUUM の二重負荷を避ける）。
-- 途中でやめるときは README の「止めるとき」に従って必ず戻す。
SET lock_timeout = '60s';
ALTER TABLE "CsvDashboardRow" SET (autovacuum_enabled = false);
