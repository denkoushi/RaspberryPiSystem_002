-- CreateTable
CREATE TABLE "ProductionScheduleDScheduleMinutesImportRun" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "meetingDate" DATE NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "originalFilePath" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "warnings" JSONB NOT NULL,
    "autoRegisteredSeibans" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionScheduleDScheduleMinutesImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleDScheduleMinutes" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "fseiban" VARCHAR(20) NOT NULL,
    "partsCompleteDate" DATE,
    "excelChangedAt" TIMESTAMP(3) NOT NULL,
    "outsourceMarks" TEXT[],
    "surfaceSendOutDates" JSONB NOT NULL,
    "memo" TEXT,
    "rawPartsCompleteText" TEXT,
    "sourceRunId" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "isAlias" BOOLEAN NOT NULL DEFAULT false,
    "aliasOf" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleDScheduleMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleDScheduleMinutesImportRun_gmailMessageId_key" ON "ProductionScheduleDScheduleMinutesImportRun"("gmailMessageId");

-- CreateIndex
CREATE INDEX "PSDScheduleRun_status_created_idx" ON "ProductionScheduleDScheduleMinutesImportRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PSDScheduleMinutes_run_idx" ON "ProductionScheduleDScheduleMinutes"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PSDScheduleMinutes_dashboard_seiban_key" ON "ProductionScheduleDScheduleMinutes"("csvDashboardId", "fseiban");

-- AddForeignKey
ALTER TABLE "ProductionScheduleDScheduleMinutes" ADD CONSTRAINT "PSDScheduleMinutes_run_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "ProductionScheduleDScheduleMinutesImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

