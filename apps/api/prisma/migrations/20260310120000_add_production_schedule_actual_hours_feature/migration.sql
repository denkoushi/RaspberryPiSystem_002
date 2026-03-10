-- CreateTable
CREATE TABLE "ProductionScheduleActualHoursRaw" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "sourceFileKey" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "sourceScheduleId" TEXT,
    "rowFingerprint" TEXT NOT NULL,
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

    CONSTRAINT "ProductionScheduleActualHoursRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleActualHoursFeature" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "fhincd" VARCHAR(40) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "medianPerPieceMinutes" DOUBLE PRECISION NOT NULL,
    "p75PerPieceMinutes" DOUBLE PRECISION,
    "windowFrom" TIMESTAMP(3) NOT NULL,
    "windowTo" TIMESTAMP(3) NOT NULL,
    "recentDaysExcluded" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleActualHoursFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleActualHoursRaw_rowFingerprint_key" ON "ProductionScheduleActualHoursRaw"("rowFingerprint");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursRaw_idx_workdate" ON "ProductionScheduleActualHoursRaw"("csvDashboardId", "workDate");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursRaw_idx_key" ON "ProductionScheduleActualHoursRaw"("csvDashboardId", "fhincd", "resourceCd", "workDate");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursRaw_idx_excluded" ON "ProductionScheduleActualHoursRaw"("csvDashboardId", "isExcluded", "workDate");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursRaw_idx_source" ON "ProductionScheduleActualHoursRaw"("sourceFileKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleActualHoursFeature_unique_key" ON "ProductionScheduleActualHoursFeature"("csvDashboardId", "location", "fhincd", "resourceCd");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursFeature_idx_location" ON "ProductionScheduleActualHoursFeature"("csvDashboardId", "location");

-- CreateIndex
CREATE INDEX "ProductionScheduleActualHoursFeature_idx_sample" ON "ProductionScheduleActualHoursFeature"("csvDashboardId", "location", "sampleCount");
