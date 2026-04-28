CREATE TABLE "ProductionScheduleFkojunstMailStatus" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "sourceCsvDashboardId" TEXT NOT NULL,
    "fkojun" VARCHAR(20) NOT NULL,
    "fkoteicd" VARCHAR(40) NOT NULL,
    "fsezono" VARCHAR(32) NOT NULL,
    "statusCode" VARCHAR(1) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScheduleFkojunstMailStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PSFkojunstMailStatus_unique_row" ON "ProductionScheduleFkojunstMailStatus"("csvDashboardRowId");

CREATE UNIQUE INDEX "PSFkojunstMailStatus_unique_src_key" ON "ProductionScheduleFkojunstMailStatus"("csvDashboardId", "sourceCsvDashboardId", "fkojun", "fkoteicd", "fsezono");

CREATE INDEX "PSFkojunstMailStatus_idx_dashboard" ON "ProductionScheduleFkojunstMailStatus"("csvDashboardId");

CREATE INDEX "PSFkojunstMailStatus_idx_source_dashboard" ON "ProductionScheduleFkojunstMailStatus"("sourceCsvDashboardId");

ALTER TABLE "ProductionScheduleFkojunstMailStatus" ADD CONSTRAINT "ProductionScheduleFkojunstMailStatus_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
