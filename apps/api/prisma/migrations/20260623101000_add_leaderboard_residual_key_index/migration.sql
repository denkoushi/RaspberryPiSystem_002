-- Optimize leaderboard process-change residual summary lookups.
--
-- The residual summary starts from a small persisted evidence key set
-- (ProductNo + FKOJUN + resource). Match the normalized SQL expressions used
-- by leaderboard-process-change-residual.service.ts so PostgreSQL can use
-- index probes instead of scanning production schedule rows for each request.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_residual_key_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (NULLIF(BTRIM("rowData"->>'ProductNo'), '')),
    (NULLIF(BTRIM("rowData"->>'FKOJUN'), '')),
    (UPPER(BTRIM("rowData"->>'FSIGENCD')))
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND NULLIF(BTRIM("rowData"->>'ProductNo'), '') IS NOT NULL
    AND NULLIF(BTRIM("rowData"->>'FKOJUN'), '') IS NOT NULL
    AND NULLIF(BTRIM("rowData"->>'FSIGENCD'), '') IS NOT NULL;
