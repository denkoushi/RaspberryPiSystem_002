-- CreateEnum
CREATE TYPE "SelfInspectionMode" AS ENUM ('FULL', 'SAMPLE');

-- AlterTable
ALTER TABLE "PartMeasurementTemplate"
ADD COLUMN "selfInspectionMode" "SelfInspectionMode" NOT NULL DEFAULT 'FULL',
ADD COLUMN "selfInspectionSampleSize" INTEGER;

-- CreateTable
CREATE TABLE "SelfInspectionSession" (
    "id" TEXT NOT NULL,
    "sessionBusinessKey" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productNo" TEXT NOT NULL,
    "processGroup" "PartMeasurementProcessGroup" NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "scheduleRowId" TEXT,
    "fseiban" TEXT,
    "fhincd" TEXT NOT NULL,
    "fhinmei" TEXT NOT NULL,
    "machineName" TEXT,
    "plannedQuantity" INTEGER NOT NULL,
    "expectedEntryCount" INTEGER NOT NULL,
    "clientDeviceId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionLotEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entryIndex" INTEGER NOT NULL,
    "createdByEmployeeId" TEXT,
    "createdByEmployeeNameSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionLotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionMeasurementValue" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "value" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionMeasurementValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionSession_sessionBusinessKey_key" ON "SelfInspectionSession"("sessionBusinessKey");

-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_business_lookup" ON "SelfInspectionSession"("productNo", "processGroup", "resourceCd");

-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_schedule_row" ON "SelfInspectionSession"("scheduleRowId");

-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_template" ON "SelfInspectionSession"("templateId");

-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_completed_at" ON "SelfInspectionSession"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionLotEntry_unique_session_entry" ON "SelfInspectionLotEntry"("sessionId", "entryIndex");

-- CreateIndex
CREATE INDEX "SelfInspectionLotEntry_idx_session" ON "SelfInspectionLotEntry"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionMeasurementValue_unique_entry_item" ON "SelfInspectionMeasurementValue"("entryId", "templateItemId");

-- CreateIndex
CREATE INDEX "SelfInspectionMeasurementValue_idx_entry" ON "SelfInspectionMeasurementValue"("entryId");

-- AddForeignKey
ALTER TABLE "SelfInspectionSession" ADD CONSTRAINT "SelfInspectionSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PartMeasurementTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionSession" ADD CONSTRAINT "SelfInspectionSession_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionLotEntry" ADD CONSTRAINT "SelfInspectionLotEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionLotEntry" ADD CONSTRAINT "SelfInspectionLotEntry_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionMeasurementValue" ADD CONSTRAINT "SelfInspectionMeasurementValue_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SelfInspectionLotEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionMeasurementValue" ADD CONSTRAINT "SelfInspectionMeasurementValue_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "PartMeasurementTemplateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
