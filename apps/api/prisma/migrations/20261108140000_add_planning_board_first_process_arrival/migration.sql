CREATE TABLE "ProductionScheduleGrindingPlanningBoardFirstProcessArrival" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "itemKey" VARCHAR(1000) NOT NULL,
    "state" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PSGrindingPlanningFirstArrival_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PSGrindingPlanningFirstArrival_state_check" CHECK ("state" IN ('arrived', 'excluded'))
);

CREATE UNIQUE INDEX "PSGrindingPlanningFirstArrival_dashboard_site_item_key"
ON "ProductionScheduleGrindingPlanningBoardFirstProcessArrival"("csvDashboardId", "siteKey", "itemKey");

ALTER TABLE "ProductionScheduleGrindingPlanningBoardFirstProcessArrival"
ADD CONSTRAINT "PSGrindingPlanningFirstArrival_dashboard_fkey" FOREIGN KEY ("csvDashboardId")
REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
