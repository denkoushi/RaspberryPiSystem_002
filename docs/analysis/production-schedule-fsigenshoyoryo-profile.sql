-- 生産日程 FSIGENSHOYORYO（所要・総分）分析 SQL
-- 対象 dashboard: 3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01
-- 実行例:
--   ssh denkon5sd02@100.106.158.2 \
--     "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -P pager=off -f -" \
--     < docs/analysis/production-schedule-fsigenshoyoryo-profile.sql

WITH winner_rows AS (
  SELECT c."id", c."rowData"
  FROM "CsvDashboardRow" c
  WHERE c."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND c."id" = (
      SELECT r2."id"
      FROM "CsvDashboardRow" r2
      WHERE r2."csvDashboardId" = c."csvDashboardId"
        AND COALESCE(r2."rowData"->>'FSEIBAN', '') = COALESCE(c."rowData"->>'FSEIBAN', '')
        AND COALESCE(r2."rowData"->>'FHINCD', '') = COALESCE(c."rowData"->>'FHINCD', '')
        AND COALESCE(r2."rowData"->>'FSIGENCD', '') = COALESCE(c."rowData"->>'FSIGENCD', '')
        AND COALESCE(r2."rowData"->>'FKOJUN', '') = COALESCE(c."rowData"->>'FKOJUN', '')
      ORDER BY
        CASE
          WHEN (r2."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN ((r2."rowData"->>'ProductNo'))::bigint
          ELSE -1
        END DESC,
        r2."createdAt" DESC,
        r2."id" DESC
      LIMIT 1
    )
),
typed AS (
  SELECT
    NULLIF(BTRIM("rowData"->>'FSEIBAN'), '') AS fseiban,
    NULLIF(BTRIM("rowData"->>'FHINCD'), '') AS fhincd,
    NULLIF(BTRIM("rowData"->>'FSIGENCD'), '') AS resource_cd,
    COALESCE("rowData"->>'FPROGRESS', '') AS progress_value,
    CASE
      WHEN ("rowData"->>'FSIGENSHOYORYO') ~ '^\s*-?\d+(\.\d+)?\s*$'
        THEN (("rowData"->>'FSIGENSHOYORYO'))::double precision
      ELSE NULL
    END AS required_minutes,
    NULLIF(BTRIM("rowData"->>'FSIGENSHOYORYO'), '') AS required_raw
  FROM winner_rows
)

-- 1. 行単位の全体分布
SELECT 'overall' AS section,
       COUNT(*) AS total_rows,
       COUNT(required_minutes) AS numeric_rows,
       COUNT(*) - COUNT(required_minutes) AS non_numeric_rows,
       COUNT(*) FILTER (WHERE required_raw IS NULL) AS blank_rows,
       COUNT(*) FILTER (WHERE required_raw IS NOT NULL AND required_minutes IS NULL) AS malformed_rows,
       COUNT(*) FILTER (WHERE required_minutes = 0) AS zero_rows,
       COUNT(*) FILTER (WHERE required_minutes < 0) AS negative_rows,
       ROUND(MIN(required_minutes)::numeric, 2) AS min_required,
       ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p25,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p50,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p75,
       ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p90,
       ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p95,
       ROUND(MAX(required_minutes)::numeric, 2) AS max_required,
       ROUND(AVG(required_minutes)::numeric, 2) AS avg_required
FROM typed;

-- 2. 完了/未完別
SELECT CASE WHEN progress_value = '完了' THEN 'completed' ELSE 'unfinished' END AS bucket,
       COUNT(*) AS rows,
       ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p25,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p50,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p75,
       ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p90,
       ROUND(AVG(required_minutes)::numeric, 2) AS avg_required
FROM typed
GROUP BY 1
ORDER BY 1;

-- 3. 製番単位の未完総所要
WITH seiban_agg AS (
  SELECT fseiban,
         COUNT(*) FILTER (WHERE progress_value <> '完了') AS unfinished_rows,
         SUM(required_minutes) FILTER (WHERE progress_value <> '完了') AS unfinished_total_required
  FROM typed
  WHERE fseiban IS NOT NULL
  GROUP BY fseiban
)
SELECT 'seiban_unfinished' AS section,
       COUNT(*) AS seiban_count,
       COUNT(*) FILTER (WHERE unfinished_rows = 0) AS zero_unfinished_count,
       ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p25,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p50,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p75,
       ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p90,
       ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p95,
       ROUND(MAX(unfinished_total_required)::numeric, 2) AS max_required,
       ROUND(AVG(unfinished_total_required)::numeric, 2) AS avg_required,
       ROUND(CORR(unfinished_rows::double precision, unfinished_total_required)::numeric, 4) AS corr_rows_required
FROM seiban_agg
WHERE unfinished_rows > 0;

-- 4. 外れ値
SELECT 'row_outliers' AS section,
       COUNT(*) FILTER (WHERE required_minutes > 630) AS gt_p95_count,
       COUNT(*) FILTER (WHERE required_minutes > 1000) AS gt_1000_count,
       COUNT(*) FILTER (WHERE required_minutes > 3000) AS gt_3000_count,
       COUNT(*) FILTER (WHERE required_minutes > 10000) AS gt_10000_count,
       COUNT(*) AS total_rows
FROM typed;

-- 5. 資源CDごとの分布（サンプル数50以上）
SELECT resource_cd,
       COUNT(*) AS rows,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p50,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p75,
       ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY required_minutes)::numeric, 2) AS p90,
       ROUND(AVG(required_minutes)::numeric, 2) AS avg_required,
       ROUND(MAX(required_minutes)::numeric, 2) AS max_required
FROM typed
WHERE resource_cd IS NOT NULL
GROUP BY resource_cd
HAVING COUNT(*) >= 50
ORDER BY rows DESC
LIMIT 20;

-- 6. 資源CD分布差の要約
WITH resource_stats AS (
  SELECT resource_cd,
         COUNT(*) AS rows,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY required_minutes) AS p50,
         PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY required_minutes) AS p90
  FROM typed
  WHERE resource_cd IS NOT NULL
  GROUP BY resource_cd
  HAVING COUNT(*) >= 50
)
SELECT 'resource_dispersion' AS section,
       COUNT(*) AS resource_count,
       ROUND(MIN(p50)::numeric, 2) AS min_p50,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p50)::numeric, 2) AS median_p50,
       ROUND(MAX(p50)::numeric, 2) AS max_p50,
       ROUND(MIN(p90)::numeric, 2) AS min_p90,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p90)::numeric, 2) AS median_p90,
       ROUND(MAX(p90)::numeric, 2) AS max_p90
FROM resource_stats;

-- 7. 品番ごとの分布（サンプル数10以上）
WITH part_agg AS (
  SELECT fhincd,
         COUNT(*) AS rows,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY required_minutes) AS p50,
         PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY required_minutes) AS p90,
         AVG(required_minutes) AS avg_required
  FROM typed
  WHERE fhincd IS NOT NULL
  GROUP BY fhincd
  HAVING COUNT(*) >= 10
)
SELECT fhincd,
       rows,
       ROUND(p50::numeric, 2) AS p50,
       ROUND(p90::numeric, 2) AS p90,
       ROUND(avg_required::numeric, 2) AS avg_required
FROM part_agg
ORDER BY rows DESC, fhincd ASC
LIMIT 20;

-- 8. current seiban に対する納期カバレッジ
WITH current_seiban AS (
  SELECT DISTINCT fseiban
  FROM typed
  WHERE fseiban IS NOT NULL
)
SELECT 'due_coverage' AS section,
       COUNT(*) AS current_seiban_count,
       COUNT(d."fseiban") AS due_joined_count,
       COUNT(*) - COUNT(d."fseiban") AS due_missing_count,
       MIN(d."dueDate") AS min_due,
       MAX(d."dueDate") AS max_due
FROM current_seiban s
LEFT JOIN "ProductionScheduleSeibanDueDate" d
  ON d."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
 AND d."fseiban" = s.fseiban;

-- 9. 納期帯ごとの未完総所要（coverage が十分になった後の spot check 用）
WITH seiban_agg AS (
  SELECT fseiban,
         SUM(required_minutes) FILTER (WHERE progress_value <> '完了') AS unfinished_total_required
  FROM typed
  WHERE fseiban IS NOT NULL
  GROUP BY fseiban
), due_join AS (
  SELECT s.fseiban,
         s.unfinished_total_required,
         d."dueDate",
         (DATE(d."dueDate") - CURRENT_DATE) AS days_until_due
  FROM seiban_agg s
  JOIN "ProductionScheduleSeibanDueDate" d
    ON d."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
   AND d."fseiban" = s.fseiban
  WHERE s.unfinished_total_required IS NOT NULL
)
SELECT CASE
         WHEN days_until_due < 0 THEN 'overdue'
         WHEN days_until_due <= 1 THEN 'today_or_tomorrow'
         WHEN days_until_due <= 3 THEN 'within_3d'
         WHEN days_until_due <= 7 THEN 'within_7d'
         ELSE 'later'
       END AS due_bucket,
       COUNT(*) AS seiban_count,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p50,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p75,
       ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY unfinished_total_required)::numeric, 2) AS p90,
       ROUND(AVG(unfinished_total_required)::numeric, 2) AS avg_required
FROM due_join
GROUP BY 1
ORDER BY 1;
