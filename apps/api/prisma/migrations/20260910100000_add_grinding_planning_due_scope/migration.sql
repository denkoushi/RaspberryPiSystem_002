-- CreateTable
CREATE TABLE "ProductionScheduleGrindingPlanningBoardDueScope" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(100) NOT NULL,
    "fseiban" VARCHAR(20) NOT NULL,
    "scopeKey" VARCHAR(80) NOT NULL,
    "scopeKind" VARCHAR(20) NOT NULL,
    "processingType" VARCHAR(20),
    "dueDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGrindingPlanningBoardDueScope_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductionScheduleGrindingPlanningBoardDueScope_csvDashboardId_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PSGrindingPlanningDueScope_dashboard_site_seiban_key" ON "ProductionScheduleGrindingPlanningBoardDueScope"("csvDashboardId", "siteKey", "fseiban", "scopeKey");
CREATE INDEX "PSGrindingPlanningDueScope_dashboard_site_seiban_idx" ON "ProductionScheduleGrindingPlanningBoardDueScope"("csvDashboardId", "siteKey", "fseiban");
