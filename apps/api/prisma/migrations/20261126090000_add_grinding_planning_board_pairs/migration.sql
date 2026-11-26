CREATE TABLE "ProductionScheduleGrindingPlanningBoardPair" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "siteKey" VARCHAR(100) NOT NULL,
  "firstPartName" VARCHAR(200) NOT NULL,
  "secondPartName" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PSGrindingPlanningPair_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PSGrindingPlanningPair_distinct_names_check" CHECK ("firstPartName" <> "secondPartName")
);
CREATE UNIQUE INDEX "PSGrindingPlanningPair_site_names_key" ON "ProductionScheduleGrindingPlanningBoardPair"("csvDashboardId", "siteKey", "firstPartName", "secondPartName");
ALTER TABLE "ProductionScheduleGrindingPlanningBoardPair" ADD CONSTRAINT "PSGrindingPlanningPair_dashboard_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
