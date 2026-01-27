-- Enable trigram search for fast partial matches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ProductNo partial match optimization (production schedule dashboard only)
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prodno_trgm_idx"
  ON "CsvDashboardRow"
  USING GIN ((("rowData"->>'ProductNo')) gin_trgm_ops)
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';

-- Sort optimization: FSEIBAN -> ProductNo -> FKOJUN (numeric if possible) -> FHINCD
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_sort_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    ("rowData"->>'FSEIBAN'),
    ("rowData"->>'ProductNo'),
    (CASE
      WHEN ("rowData"->>'FKOJUN') ~ '^\d+$' THEN (("rowData"->>'FKOJUN'))::int
      ELSE NULL
    END),
    ("rowData"->>'FHINCD')
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
