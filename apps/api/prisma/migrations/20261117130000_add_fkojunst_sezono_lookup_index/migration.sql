-- Look up raw FKOJUNST_Status rows by ProductNo for arrival resource-swap evidence.
-- Keep the predicate aligned with FKOJUNST_SEZONO_INDEX_PREDICATE in
-- production-schedule/process-arrival-resource-swap.ts.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_fkojunst_sezono_idx"
  ON "CsvDashboardRow" ((BTRIM("rowData"->>'FSEZONO')))
  WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e';
