-- site scope conflict check: csvDashboardId + siteKey + resourceCd + orderNumber
CREATE INDEX "PSOrderSplitAssign_idx_site_resource_order"
  ON "ProductionScheduleOrderSplitAssignment"("csvDashboardId", "siteKey", "resourceCd", "orderNumber");
