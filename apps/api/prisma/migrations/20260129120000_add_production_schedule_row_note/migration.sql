-- CreateTable
CREATE TABLE "ProductionScheduleRowNote" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "note" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleRowNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleRowNote_csvDashboardRowId_location_key" ON "ProductionScheduleRowNote"("csvDashboardRowId", "location");

-- CreateIndex
CREATE INDEX "ProductionScheduleRowNote_csvDashboardId_location_idx" ON "ProductionScheduleRowNote"("csvDashboardId", "location");

-- AddForeignKey
ALTER TABLE "ProductionScheduleRowNote" ADD CONSTRAINT "ProductionScheduleRowNote_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
