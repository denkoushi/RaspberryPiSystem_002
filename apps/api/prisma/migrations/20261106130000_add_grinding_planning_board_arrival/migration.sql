CREATE TABLE "ProductionScheduleGrindingPlanningBoardArrival" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "itemKey" VARCHAR(1000) NOT NULL,
    "arrivalDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionScheduleGrindingPlanningBoardArrival_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PSGrindingPlanningArrival_dashboard_site_date_item_key"
ON "ProductionScheduleGrindingPlanningBoardArrival"("csvDashboardId", "siteKey", "arrivalDate", "itemKey");

ALTER TABLE "ProductionScheduleGrindingPlanningBoardArrival"
ADD CONSTRAINT "PSGrindingPlanningArrival_dashboard_fkey" FOREIGN KEY ("csvDashboardId")
REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
