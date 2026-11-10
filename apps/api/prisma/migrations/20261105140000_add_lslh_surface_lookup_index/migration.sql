-- Find LSLH surface-treatment parts for the grinding planning board.
--
-- FKOJUNST_Status raw rows (~1M) are looked up by trimmed FSEZONO for the two
-- LSLH process codes (docs/analysis/surface-treatment-process-codes-20261105.md).
-- Without this partial index the lookup scans every raw row (~1.5s per board load).
-- Keep the predicate in sync with LSLH_SURFACE_PROCESS_CODES and the SQL in
-- grinding-planning-board/read.ts.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_fkojunst_lslh_surface_idx"
  ON "CsvDashboardRow" ((BTRIM("rowData"->>'FSEZONO')))
  WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
    AND "rowData"->>'FKOTEICD' IN ('1143016000', '1143016002');
