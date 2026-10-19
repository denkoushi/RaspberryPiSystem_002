-- CreateTable
CREATE TABLE "ProductionScheduleGrindingPlanningBoardState" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "seibanOrder" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGrindingPlanningBoardState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleGrindingPlanningBoardOverride" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "itemKey" VARCHAR(1000) NOT NULL,
    "overrideResourceCd" VARCHAR(20),
    "overrideDueDate" DATE,
    "alternateRank" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGrindingPlanningBoardOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PSGrindingPlanningState_dashboard_site_key" ON "ProductionScheduleGrindingPlanningBoardState"("csvDashboardId", "siteKey");
CREATE INDEX "PSGrindingPlanningState_dashboard_updated_idx" ON "ProductionScheduleGrindingPlanningBoardState"("csvDashboardId", "updatedAt");
CREATE UNIQUE INDEX "PSGrindingPlanningOverride_dashboard_site_item_key" ON "ProductionScheduleGrindingPlanningBoardOverride"("csvDashboardId", "siteKey", "itemKey");
CREATE INDEX "PSGrindingPlanningOverride_dashboard_site_idx" ON "ProductionScheduleGrindingPlanningBoardOverride"("csvDashboardId", "siteKey");
CREATE INDEX "PSGrindingPlanningOverride_resource_idx" ON "ProductionScheduleGrindingPlanningBoardOverride"("csvDashboardId", "siteKey", "overrideResourceCd");

-- AddForeignKey
ALTER TABLE "ProductionScheduleGrindingPlanningBoardState" ADD CONSTRAINT "ProductionScheduleGrindingPlanningBoardState_csvDashboardId_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionScheduleGrindingPlanningBoardOverride" ADD CONSTRAINT "ProductionScheduleGrindingPlanningBoardOverride_csvDashboardId_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
