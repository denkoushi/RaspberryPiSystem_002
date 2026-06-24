-- loadSplitsForParents: csvDashboardId + parentCsvDashboardRowId IN (...) + ORDER BY splitNo
CREATE INDEX "PSOrderSplit_idx_dashboard_parent_split_no"
  ON "ProductionScheduleOrderSplit"("csvDashboardId", "parentCsvDashboardRowId", "splitNo");
