-- Keep this expression index in migration SQL, like the existing leaderboard lookup indexes.
CREATE INDEX IF NOT EXISTS "CsvDashboardRow_csvDashboardId_btrim_fseiban_fhincd_idx"
  ON "CsvDashboardRow" ("csvDashboardId", BTRIM("rowData"->>'FSEIBAN'), BTRIM("rowData"->>'FHINCD'));
