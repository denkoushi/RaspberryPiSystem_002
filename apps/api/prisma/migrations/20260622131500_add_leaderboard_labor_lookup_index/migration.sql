-- Optimize kiosk leaderboard labor-minute lookup.
--
-- The lookup joins visible production rows to FSIGENCD=10 labor rows by
-- trimmed ProductNo + FKOJUN. Match the existing SQL expressions exactly so
-- PostgreSQL can avoid scanning all labor rows for every board shell/continue.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_labor_lookup_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (BTRIM("rowData"->>'ProductNo')),
    (BTRIM("rowData"->>'FKOJUN'))
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND UPPER(BTRIM("rowData"->>'FSIGENCD')) = '10';
