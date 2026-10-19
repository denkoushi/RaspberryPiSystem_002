-- CreateTable
CREATE TABLE "MachineSignalSensor" (
    "signalNo" INTEGER NOT NULL,
    "sourceMachineName" VARCHAR(200) NOT NULL,
    "displayName" VARCHAR(200),
    "site" VARCHAR(80),
    "kind" VARCHAR(16) NOT NULL DEFAULT 'MACHINE',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "plannedStartMinute" INTEGER,
    "plannedEndMinute" INTEGER,
    "runningKw" DOUBLE PRECISION,
    "idleKw" DOUBLE PRECISION,
    "categoryOverrides" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineSignalSensor_pkey" PRIMARY KEY ("signalNo")
);

-- CreateTable
CREATE TABLE "MachineSignalDailyReport" (
    "id" TEXT NOT NULL,
    "signalNo" INTEGER NOT NULL,
    "reportDate" DATE NOT NULL,
    "machineName" VARCHAR(200) NOT NULL,
    "dayStartMinute" INTEGER NOT NULL DEFAULT 480,
    "summary" JSONB NOT NULL,
    "stateNames" JSONB NOT NULL,
    "segments" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "sourceFileName" VARCHAR(255) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineSignalDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineSignalSettingsConfig" (
    "key" VARCHAR(80) NOT NULL,
    "nightStartMinute" INTEGER NOT NULL DEFAULT 1200,
    "thresholds" JSONB NOT NULL,
    "updatedBy" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineSignalSettingsConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MachineSignalImportRun" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "gmailMessageId" VARCHAR(120),
    "status" VARCHAR(16) NOT NULL,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineSignalImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineSignalDailyReport_idx_date" ON "MachineSignalDailyReport"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "MachineSignalDailyReport_signal_date_key" ON "MachineSignalDailyReport"("signalNo", "reportDate");

-- CreateIndex
CREATE INDEX "MachineSignalImportRun_idx_message" ON "MachineSignalImportRun"("gmailMessageId");

-- CreateIndex
CREATE INDEX "MachineSignalImportRun_idx_started" ON "MachineSignalImportRun"("startedAt");
