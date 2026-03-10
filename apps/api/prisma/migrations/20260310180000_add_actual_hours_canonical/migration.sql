-- CreateTable
CREATE TABLE "ProductionScheduleActualHoursCanonical" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "logicalKeyHash" TEXT NOT NULL,
    "rawId" TEXT NOT NULL,
    "sourceFileKey" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "sourceScheduleId" TEXT,
    "winnerRule" VARCHAR(40) NOT NULL,
    "winnerAt" TIMESTAMP(3) NOT NULL,
    "rawCreatedAt" TIMESTAMP(3) NOT NULL,
    "rawUpdatedAt" TIMESTAMP(3) NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "fseiban" VARCHAR(20),
    "fhincd" VARCHAR(40) NOT NULL,
    "lotNo" VARCHAR(20),
    "lotQty" DOUBLE PRECISION NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "processOrder" INTEGER,
    "actualMinutes" DOUBLE PRECISION NOT NULL,
    "perPieceMinutes" DOUBLE PRECISION NOT NULL,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "excludeReason" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleActualHoursCanonical_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleActualHoursCanonical_unique_key"
ON "ProductionScheduleActualHoursCanonical"("csvDashboardId", "location", "logicalKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleActualHoursCanonical_unique_raw"
ON "ProductionScheduleActualHoursCanonical"("csvDashboardId", "location", "rawId");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursCanonical_idx_location"
ON "ProductionScheduleActualHoursCanonical"("csvDashboardId", "location");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursCanonical_idx_feature_key"
ON "ProductionScheduleActualHoursCanonical"("csvDashboardId", "location", "fhincd", "resourceCd");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursCanonical_idx_workdate"
ON "ProductionScheduleActualHoursCanonical"("csvDashboardId", "location", "workDate");
