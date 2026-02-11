-- Production schedule dashboard: optimize resource list extraction
-- and logical-key lookup used by max ProductNo winner selection.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_resource_cd_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    ("rowData"->>'FSIGENCD')
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND ("rowData"->>'FSIGENCD') IS NOT NULL
    AND ("rowData"->>'FSIGENCD') <> '';

CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_logical_key_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (COALESCE("rowData"->>'FSEIBAN', '')),
    (COALESCE("rowData"->>'FHINCD', '')),
    (COALESCE("rowData"->>'FSIGENCD', '')),
    (COALESCE("rowData"->>'FKOJUN', ''))
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';

-- Match the winner subquery ORDER BY to avoid repeated seq scans.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_winner_lookup_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (COALESCE("rowData"->>'FSEIBAN', '')),
    (COALESCE("rowData"->>'FHINCD', '')),
    (COALESCE("rowData"->>'FSIGENCD', '')),
    (COALESCE("rowData"->>'FKOJUN', '')),
    (CASE
      WHEN ("rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("rowData"->>'ProductNo'))::bigint
      ELSE -1
    END) DESC,
    "createdAt" DESC,
    "id" DESC
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';

-- Non-partial variant for correlated subquery planner pick-up.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_winner_lookup_global_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (COALESCE("rowData"->>'FSEIBAN', '')),
    (COALESCE("rowData"->>'FHINCD', '')),
    (COALESCE("rowData"->>'FSIGENCD', '')),
    (COALESCE("rowData"->>'FKOJUN', '')),
    (CASE
      WHEN ("rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("rowData"->>'ProductNo'))::bigint
      ELSE -1
    END) DESC,
    "createdAt" DESC,
    "id" DESC
  );
