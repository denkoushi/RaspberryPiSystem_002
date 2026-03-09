-- CreateTable
CREATE TABLE "ProductionScheduleGlobalRowRank" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "fseiban" VARCHAR(20) NOT NULL,
    "globalRank" INTEGER NOT NULL,
    "sourceType" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGlobalRowRank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleGlobalRowRank_unique_row" ON "ProductionScheduleGlobalRowRank"("csvDashboardId", "location", "csvDashboardRowId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleGlobalRowRank_unique_rank" ON "ProductionScheduleGlobalRowRank"("csvDashboardId", "location", "globalRank");

-- CreateIndex
CREATE INDEX "ProductionScheduleGlobalRowRank_idx_rank" ON "ProductionScheduleGlobalRowRank"("csvDashboardId", "location", "globalRank");

-- CreateIndex
CREATE INDEX "ProductionScheduleGlobalRowRank_idx_fseiban" ON "ProductionScheduleGlobalRowRank"("csvDashboardId", "location", "fseiban");

-- AddForeignKey
ALTER TABLE "ProductionScheduleGlobalRowRank" ADD CONSTRAINT "ProductionScheduleGlobalRowRank_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
