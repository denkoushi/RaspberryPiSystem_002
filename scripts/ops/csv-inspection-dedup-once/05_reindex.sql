-- 04_finish.sql の後に流す。VACUUM では縮まない索引を、表を止めずに1本ずつ作り直す。
-- REINDEX CONCURRENTLY は1本ごとに独立しているので、途中で止めても済んだ分は残る。
-- 失敗して残った作り直し途中の索引（名前が *_ccnew）は、最後の確認で一覧に出る。
\set ON_ERROR_STOP on
\timing on
SET statement_timeout = 0;
SET lock_timeout = '30s';

-- 前回の作り直しが途中で止まって無効な索引（*_ccnew / *_ccold）が残っていたら、始めない。
SELECT count(*) > 0 AS has_invalid
FROM pg_index WHERE indrelid = '"CsvDashboardRow"'::regclass AND NOT indisvalid \gset
\if :has_invalid
  \echo 'invalid indexes remain; drop them first (README).'
  SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = '"CsvDashboardRow"'::regclass AND NOT i.indisvalid;
  \quit
\endif

SELECT pg_size_pretty(pg_indexes_size('"CsvDashboardRow"')) AS indexes_before;

REINDEX INDEX CONCURRENTLY "CsvDashboardRow_csvDashboardId_idx";
REINDEX INDEX CONCURRENTLY "CsvDashboardRow_csvDashboardId_updatedAt_idx";
REINDEX INDEX CONCURRENTLY "CsvDashboardRow_csvDashboardId_occurredAt_idx";
REINDEX INDEX CONCURRENTLY "CsvDashboardRow_csvDashboardId_dataHash_idx";
REINDEX INDEX CONCURRENTLY "CsvDashboardRow_pkey";
REINDEX INDEX CONCURRENTLY "CsvDashRow_srcRunStart_rowOrd_idx";
REINDEX INDEX CONCURRENTLY "CsvDashRow_srcRun_rowOrd_idx";
REINDEX INDEX CONCURRENTLY csv_dashboard_row_winner_lookup_global_idx;

SELECT pg_size_pretty(pg_indexes_size('"CsvDashboardRow"')) AS indexes_after;

SELECT c.relname AS index_name, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = '"CsvDashboardRow"'::regclass
ORDER BY pg_relation_size(c.oid) DESC;
