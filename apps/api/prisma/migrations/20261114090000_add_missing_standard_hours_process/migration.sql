CREATE TABLE "ProductionScheduleMissingStandardHoursProcess" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "fsezono" VARCHAR(32) NOT NULL,
    "fkojun" VARCHAR(20) NOT NULL,
    "fkoteicd" VARCHAR(40) NOT NULL,
    "statusCode" VARCHAR(1) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScheduleMissingStandardHoursProcess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PSMissingStandardHours_unique_key"
    ON "ProductionScheduleMissingStandardHoursProcess"("csvDashboardId", "fsezono", "fkojun", "fkoteicd");
CREATE INDEX "PSMissingStandardHours_idx_generation"
    ON "ProductionScheduleMissingStandardHoursProcess"("csvDashboardId", "updatedAt");
