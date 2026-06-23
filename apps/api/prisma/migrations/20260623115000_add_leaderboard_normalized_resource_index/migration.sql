-- Optimize leaderboard board resource-slot row selection.
--
-- The board filter normalizes resource codes with UPPER(BTRIM(...)); the
-- older raw FSIGENCD expression index does not match that predicate and was
-- not being selected on Pi5. Include id so the winner-id membership filter can
-- still be applied after narrowing to the resource slot.
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_resource_norm_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (UPPER(BTRIM("rowData"->>'FSIGENCD'))),
    "id"
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
