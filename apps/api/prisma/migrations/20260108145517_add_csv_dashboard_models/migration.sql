-- CreateEnum
CREATE TYPE "CsvDashboardIngestMode" AS ENUM ('APPEND', 'DEDUP');

-- CreateEnum
CREATE TYPE "CsvDashboardTemplateType" AS ENUM ('TABLE', 'CARD_GRID');

-- CreateTable
CREATE TABLE "CsvDashboard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columnDefinitions" JSONB NOT NULL,
    "dateColumnName" TEXT,
    "displayPeriodDays" INTEGER NOT NULL DEFAULT 1,
    "emptyMessage" TEXT,
    "ingestMode" "CsvDashboardIngestMode" NOT NULL DEFAULT 'APPEND',
    "dedupKeyColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gmailScheduleId" TEXT,
    "templateType" "CsvDashboardTemplateType" NOT NULL DEFAULT 'TABLE',
    "templateConfig" JSONB NOT NULL,
    "csvFilePath" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvDashboardIngestRun" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "messageSubject" TEXT,
    "csvFilePath" TEXT,
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsAdded" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CsvDashboardIngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvDashboardRow" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dataHash" TEXT,
    "rowData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvDashboardRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CsvDashboard_enabled_idx" ON "CsvDashboard"("enabled");

-- CreateIndex
CREATE INDEX "CsvDashboard_gmailScheduleId_idx" ON "CsvDashboard"("gmailScheduleId");

-- CreateIndex
CREATE INDEX "CsvDashboardIngestRun_csvDashboardId_idx" ON "CsvDashboardIngestRun"("csvDashboardId");

-- CreateIndex
CREATE INDEX "CsvDashboardIngestRun_status_idx" ON "CsvDashboardIngestRun"("status");

-- CreateIndex
CREATE INDEX "CsvDashboardIngestRun_startedAt_idx" ON "CsvDashboardIngestRun"("startedAt");

-- CreateIndex
CREATE INDEX "CsvDashboardRow_csvDashboardId_idx" ON "CsvDashboardRow"("csvDashboardId");

-- CreateIndex
CREATE INDEX "CsvDashboardRow_csvDashboardId_occurredAt_idx" ON "CsvDashboardRow"("csvDashboardId", "occurredAt");

-- CreateIndex
CREATE INDEX "CsvDashboardRow_csvDashboardId_dataHash_idx" ON "CsvDashboardRow"("csvDashboardId", "dataHash");

-- AddForeignKey
ALTER TABLE "CsvDashboardIngestRun" ADD CONSTRAINT "CsvDashboardIngestRun_csvDashboardId_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvDashboardRow" ADD CONSTRAINT "CsvDashboardRow_csvDashboardId_fkey" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
