-- CreateTable
CREATE TABLE "ProductionScheduleGlobalRank" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "fseiban" VARCHAR(20) NOT NULL,
    "priorityOrder" INTEGER NOT NULL,
    "sourceType" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGlobalRank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleGlobalRank_unique_fseiban" ON "ProductionScheduleGlobalRank"("csvDashboardId", "location", "fseiban");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleGlobalRank_unique_order" ON "ProductionScheduleGlobalRank"("csvDashboardId", "location", "priorityOrder");

-- CreateIndex
CREATE INDEX "ProductionScheduleGlobalRank_idx_order" ON "ProductionScheduleGlobalRank"("csvDashboardId", "location", "priorityOrder");
