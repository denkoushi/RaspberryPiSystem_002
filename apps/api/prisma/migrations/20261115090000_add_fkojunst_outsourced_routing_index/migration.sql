-- Find outsourced routing steps (FKOTEICD = 10-digit supplier code) for the
-- grinding planning board arrival check.
--
-- FKOJUNST_Status raw rows (~1M, ~350k outsourced) are looked up by trimmed
-- FSEZONO. Keep the predicate in sync with OUTSOURCED_ROUTING_INDEX_PREDICATE in
-- production-schedule/outsourced-routing-arrival.service.ts.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_fkojunst_outsourced_idx"
  ON "CsvDashboardRow" ((BTRIM("rowData"->>'FSEZONO')))
  WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
    AND BTRIM("rowData"->>'FKOTEICD') ~ '^[0-9]{10}$';
