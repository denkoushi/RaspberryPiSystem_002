-- CreateTable
CREATE TABLE "ProductionScheduleResourceCodeMapping" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "fromResourceCd" VARCHAR(20) NOT NULL,
    "toResourceCd" VARCHAR(20) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleResourceCodeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleResourceCodeMapping_unique_pair" ON "ProductionScheduleResourceCodeMapping"("csvDashboardId", "location", "fromResourceCd", "toResourceCd");

-- CreateIndex
CREATE INDEX "ProductionScheduleResourceCodeMapping_idx_lookup" ON "ProductionScheduleResourceCodeMapping"("csvDashboardId", "location", "fromResourceCd", "enabled", "priority");
