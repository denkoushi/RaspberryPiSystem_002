-- CreateTable
CREATE TABLE "ProductionScheduleGrindingPlanningBoardResourceCapacity" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "dailyHours" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGrindingPlanningBoardResourceCapacity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PSGrindingPlanningCapacity_daily_hours_check" CHECK ("dailyHours" IN (8, 10, 24))
);

-- CreateIndex
CREATE UNIQUE INDEX "PSGrindingPlanningCapacity_dashboard_site_resource_key" ON "ProductionScheduleGrindingPlanningBoardResourceCapacity"("csvDashboardId", "siteKey", "resourceCd");

-- AddForeignKey
ALTER TABLE "ProductionScheduleGrindingPlanningBoardResourceCapacity" ADD CONSTRAINT "PSGrindingPlanningCapacity_dashboard_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
