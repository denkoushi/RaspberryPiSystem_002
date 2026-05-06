-- Improves correlated globalRank lookups by CsvDashboardRow.id
CREATE INDEX "ProductionScheduleGlobalRowRank_idx_csv_dashboard_row_id" ON "ProductionScheduleGlobalRowRank"("csvDashboardRowId");
