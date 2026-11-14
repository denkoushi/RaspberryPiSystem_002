CREATE TABLE "ProductionScheduleRowSeen" (
    "dataHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScheduleRowSeen_pkey" PRIMARY KEY ("dataHash")
);
ALTER TABLE "CsvDashboardIngestRun" ADD COLUMN "rowSeenRecordedAt" TIMESTAMP(3);
CREATE INDEX "CsvDashboardIngestRun_csvDashboardId_status_sourceReceivedAt_idx"
    ON "CsvDashboardIngestRun"("csvDashboardId", "status", "sourceReceivedAt");
