-- CreateTable
CREATE TABLE "ProductionScheduleExternalCompletion" (
    "csvDashboardRowId" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "isExternallyCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleExternalCompletion_pkey" PRIMARY KEY ("csvDashboardRowId")
);

-- CreateIndex
CREATE INDEX "ProductionScheduleExternalCompletion_csvDashboardId_isExternallyCompleted_idx" ON "ProductionScheduleExternalCompletion"("csvDashboardId", "isExternallyCompleted");

-- AddForeignKey
ALTER TABLE "ProductionScheduleExternalCompletion" ADD CONSTRAINT "ProductionScheduleExternalCompletion_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
