-- CreateTable
CREATE TABLE "CsvImportHistory" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "scheduleName" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "employeesPath" TEXT,
    "itemsPath" TEXT,
    "summary" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvImportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CsvImportHistory_scheduleId_idx" ON "CsvImportHistory"("scheduleId");

-- CreateIndex
CREATE INDEX "CsvImportHistory_status_idx" ON "CsvImportHistory"("status");

-- CreateIndex
CREATE INDEX "CsvImportHistory_startedAt_idx" ON "CsvImportHistory"("startedAt");

-- CreateIndex
CREATE INDEX "CsvImportHistory_completedAt_idx" ON "CsvImportHistory"("completedAt");
