CREATE TABLE "ProductionScheduleGrindingPlanningBoardResourceMinutesSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "source" TEXT NOT NULL CHECK ("source" = 'own'),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PSGrindingPlanningMinutesSource_site_resource_key" ON "ProductionScheduleGrindingPlanningBoardResourceMinutesSource"("csvDashboardId", "siteKey", "resourceCd");
ALTER TABLE "ProductionScheduleGrindingPlanningBoardResourceMinutesSource" ADD CONSTRAINT "PSGrindingPlanningMinutesSource_dashboard_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductionScheduleGrindingPlanningBoardResourcePartMinutes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "fhincd" VARCHAR(120) NOT NULL,
    "perUnitMinutes" DOUBLE PRECISION NOT NULL CHECK ("perUnitMinutes" >= 0 AND "perUnitMinutes" <= 100000),
    "setupMinutes" INTEGER NOT NULL CHECK ("setupMinutes" >= 0 AND "setupMinutes" <= 100000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PSGrindingPlanningPartMinutes_site_resource_key" ON "ProductionScheduleGrindingPlanningBoardResourcePartMinutes"("csvDashboardId", "siteKey", "resourceCd", "fhincd");
ALTER TABLE "ProductionScheduleGrindingPlanningBoardResourcePartMinutes" ADD CONSTRAINT "PSGrindingPlanningPartMinutes_dashboard_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

