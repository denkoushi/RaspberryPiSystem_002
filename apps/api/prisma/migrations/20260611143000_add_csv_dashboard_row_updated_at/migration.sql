ALTER TABLE "CsvDashboardRow"
ADD COLUMN "updatedAt" TIMESTAMP(3);

ALTER TABLE "CsvDashboardRow"
ADD COLUMN "sourceIngestRunId" TEXT;

ALTER TABLE "CsvDashboardRow"
ADD COLUMN "sourceRowOrdinal" INTEGER;

ALTER TABLE "CsvDashboardRow"
ADD COLUMN "sourceIngestRunStartedAt" TIMESTAMP(3);

ALTER TABLE "CsvDashboardRow"
ADD CONSTRAINT "CsvDashboardRow_sourceIngestRunId_fkey"
FOREIGN KEY ("sourceIngestRunId") REFERENCES "CsvDashboardIngestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CsvDashboardRow_csvDashboardId_updatedAt_idx"
ON "CsvDashboardRow"("csvDashboardId", "updatedAt");

CREATE INDEX "CsvDashboardIngestRun_completedAt_idx"
ON "CsvDashboardIngestRun"("completedAt");

CREATE INDEX "CsvDashRow_srcRun_rowOrd_idx"
ON "CsvDashboardRow"("csvDashboardId", "sourceIngestRunId", "sourceRowOrdinal");

CREATE INDEX "CsvDashRow_srcRunStart_rowOrd_idx"
ON "CsvDashboardRow"("csvDashboardId", "sourceIngestRunStartedAt", "sourceRowOrdinal");
