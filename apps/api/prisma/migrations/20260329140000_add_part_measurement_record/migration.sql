-- CreateEnum
CREATE TYPE "PartMeasurementProcessGroup" AS ENUM ('CUTTING', 'GRINDING');

-- CreateEnum
CREATE TYPE "PartMeasurementSheetStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateTable
CREATE TABLE "PartMeasurementTemplate" (
    "id" TEXT NOT NULL,
    "fhincd" TEXT NOT NULL,
    "processGroup" "PartMeasurementProcessGroup" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMeasurementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartMeasurementTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "datumSurface" TEXT NOT NULL,
    "measurementPoint" TEXT NOT NULL,
    "measurementLabel" TEXT NOT NULL,
    "unit" TEXT,
    "allowNegative" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMeasurementTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartMeasurementSheet" (
    "id" TEXT NOT NULL,
    "status" "PartMeasurementSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "productNo" TEXT NOT NULL,
    "fseiban" TEXT NOT NULL,
    "fhincd" TEXT NOT NULL,
    "fhinmei" TEXT NOT NULL,
    "machineName" TEXT,
    "resourceCdSnapshot" TEXT,
    "processGroupSnapshot" "PartMeasurementProcessGroup" NOT NULL,
    "employeeId" TEXT,
    "employeeNameSnapshot" TEXT,
    "quantity" INTEGER,
    "scannedBarcodeRaw" TEXT,
    "templateId" TEXT,
    "clientDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "PartMeasurementSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartMeasurementResult" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "pieceIndex" INTEGER NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "value" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMeasurementResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartMeasurementTemplate_unique_fhincd_group_version" ON "PartMeasurementTemplate"("fhincd", "processGroup", "version");

-- CreateIndex
CREATE INDEX "PartMeasurementTemplate_idx_lookup" ON "PartMeasurementTemplate"("fhincd", "processGroup", "isActive");

-- CreateIndex
CREATE INDEX "PartMeasurementTemplateItem_templateId_sortOrder_idx" ON "PartMeasurementTemplateItem"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "PartMeasurementSheet_idx_status_updated" ON "PartMeasurementSheet"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PartMeasurementSheet_idx_fseiban" ON "PartMeasurementSheet"("fseiban");

-- CreateIndex
CREATE UNIQUE INDEX "PartMeasurementResult_unique_cell" ON "PartMeasurementResult"("sheetId", "pieceIndex", "templateItemId");

-- CreateIndex
CREATE INDEX "PartMeasurementResult_idx_sheet" ON "PartMeasurementResult"("sheetId");

-- AddForeignKey
ALTER TABLE "PartMeasurementTemplateItem" ADD CONSTRAINT "PartMeasurementTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PartMeasurementTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PartMeasurementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMeasurementResult" ADD CONSTRAINT "PartMeasurementResult_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "PartMeasurementSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartMeasurementResult" ADD CONSTRAINT "PartMeasurementResult_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "PartMeasurementTemplateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
