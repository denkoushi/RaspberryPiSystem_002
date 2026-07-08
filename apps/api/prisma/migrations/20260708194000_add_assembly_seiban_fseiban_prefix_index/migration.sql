-- Optimize assembly kiosk seiban candidate prefix search.
--
-- Match the candidate query expression (UPPER(COALESCE(FSEIBAN))) with text_pattern_ops
-- so PostgreSQL can satisfy prefix LIKE probes without scanning all production rows.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_seiban_prefix_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (UPPER(COALESCE("rowData"->>'FSEIBAN', '')) text_pattern_ops)
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
