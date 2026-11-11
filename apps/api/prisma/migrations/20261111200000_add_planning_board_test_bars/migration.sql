CREATE TABLE "ProductionScheduleGrindingPlanningBoardTestBar" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "siteKey" VARCHAR(100) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "resourceCd" VARCHAR(20) NOT NULL,
  "minutes" INTEGER NOT NULL,
  "alternateRank" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "completedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PSGrindingPlanningTestBar_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PSGrindingPlanningTestBar_minutes_check" CHECK ("minutes" BETWEEN 5 AND 1440),
  CONSTRAINT "PSGrindingPlanningTestBar_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "PSGrindingPlanningTestBar_rank_check" CHECK ("alternateRank" > 0),
  CONSTRAINT "PSGrindingPlanningTestBar_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "PSGrindingPlanningTestBar_site_sequence_key" ON "ProductionScheduleGrindingPlanningBoardTestBar"("csvDashboardId", "siteKey", "sequence");
CREATE INDEX "PSGrindingPlanningTestBar_resource_idx" ON "ProductionScheduleGrindingPlanningBoardTestBar"("csvDashboardId", "siteKey", "resourceCd", "deletedAt", "completedAt");
ALTER TABLE "ProductionScheduleGrindingPlanningBoardTestBar" ADD CONSTRAINT "PSGrindingPlanningTestBar_dashboard_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
