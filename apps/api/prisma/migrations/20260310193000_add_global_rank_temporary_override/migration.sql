-- CreateTable
CREATE TABLE "ProductionScheduleGlobalRankTemporaryOverride" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "targetLocation" TEXT NOT NULL,
    "orderedFseibans" TEXT[],
    "actorClientKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleGlobalRankTemporaryOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleGlobalRankTempOverride_unique_target"
ON "ProductionScheduleGlobalRankTemporaryOverride"("csvDashboardId", "targetLocation");

-- CreateIndex
CREATE INDEX "ProductionScheduleGlobalRankTempOverride_idx_expiry"
ON "ProductionScheduleGlobalRankTemporaryOverride"("csvDashboardId", "expiresAt");
