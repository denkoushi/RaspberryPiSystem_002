-- CreateTable
CREATE TABLE "ProductionScheduleManualOrderResourceAssignment" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "deviceScopeKey" TEXT NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleManualOrderResourceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ps_mo_res_assign_site_resource_cd_key" ON "ProductionScheduleManualOrderResourceAssignment"("csvDashboardId", "siteKey", "resourceCd");

-- CreateIndex
CREATE UNIQUE INDEX "ps_mo_res_assign_device_priority_key" ON "ProductionScheduleManualOrderResourceAssignment"("csvDashboardId", "deviceScopeKey", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ps_mo_res_assign_device_resource_cd_key" ON "ProductionScheduleManualOrderResourceAssignment"("csvDashboardId", "deviceScopeKey", "resourceCd");

-- CreateIndex
CREATE INDEX "ProductionScheduleManualOrderResourceAssignment_csvDashboardId_siteKey_idx" ON "ProductionScheduleManualOrderResourceAssignment"("csvDashboardId", "siteKey");
