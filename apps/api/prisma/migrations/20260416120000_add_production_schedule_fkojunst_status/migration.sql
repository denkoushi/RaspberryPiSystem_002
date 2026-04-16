-- CreateTable
CREATE TABLE "ProductionScheduleFkojunstStatus" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "sourceCsvDashboardId" TEXT NOT NULL,
    "productNo" VARCHAR(20) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "processOrder" VARCHAR(20) NOT NULL,
    "statusCode" VARCHAR(1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleFkojunstStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleFkojunstStatus_unique_row" ON "ProductionScheduleFkojunstStatus"("csvDashboardRowId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleFkojunstStatus_unique_source_key" ON "ProductionScheduleFkojunstStatus"("csvDashboardId", "sourceCsvDashboardId", "productNo", "resourceCd", "processOrder");

-- CreateIndex
CREATE INDEX "ProductionScheduleFkojunstStatus_idx_dashboard" ON "ProductionScheduleFkojunstStatus"("csvDashboardId");

-- CreateIndex
CREATE INDEX "ProductionScheduleFkojunstStatus_idx_source_dashboard" ON "ProductionScheduleFkojunstStatus"("sourceCsvDashboardId");

-- AddForeignKey
ALTER TABLE "ProductionScheduleFkojunstStatus" ADD CONSTRAINT "ProductionScheduleFkojunstStatus_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
