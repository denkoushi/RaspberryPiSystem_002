-- The partial index csv_dashboard_row_fkojunst_sezono_idx is not used for row estimates:
-- PostgreSQL ignores expression statistics of partial indexes, so the planner guesses 0.5%
-- per FSEZONO value and picks a Seq Scan for the process-arrival resource-swap lookup.
-- A non-partial index gives the expression real statistics (after the next ANALYZE).
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_dashboard_sezono_idx"
  ON "CsvDashboardRow" ("csvDashboardId", (BTRIM("rowData"->>'FSEZONO')));
