-- CreateTable
CREATE TABLE "ProductionScheduleOrderAssignment" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleOrderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskProductionScheduleSearchState" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskProductionScheduleSearchState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionScheduleOrderAssignment_csvDashboardId_location_r_idx" ON "ProductionScheduleOrderAssignment"("csvDashboardId", "location", "resourceCd");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleOrderAssignment_csvDashboardId_location_r_key" ON "ProductionScheduleOrderAssignment"("csvDashboardId", "location", "resourceCd", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleOrderAssignment_csvDashboardRowId_locatio_key" ON "ProductionScheduleOrderAssignment"("csvDashboardRowId", "location");

-- CreateIndex
CREATE INDEX "KioskProductionScheduleSearchState_csvDashboardId_idx" ON "KioskProductionScheduleSearchState"("csvDashboardId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskProductionScheduleSearchState_csvDashboardId_location_key" ON "KioskProductionScheduleSearchState"("csvDashboardId", "location");

-- AddForeignKey
ALTER TABLE "ProductionScheduleOrderAssignment" ADD CONSTRAINT "ProductionScheduleOrderAssignment_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
