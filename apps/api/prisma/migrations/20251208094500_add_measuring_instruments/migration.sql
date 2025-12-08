-- CreateEnum
CREATE TYPE "MeasuringInstrumentStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "MeasuringInstrument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managementNumber" TEXT NOT NULL,
    "storageLocation" TEXT,
    "measurementRange" TEXT,
    "calibrationExpiryDate" TIMESTAMP(3),
    "status" "MeasuringInstrumentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasuringInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionItem" (
    "id" TEXT NOT NULL,
    "measuringInstrumentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionRecord" (
    "id" TEXT NOT NULL,
    "measuringInstrumentId" TEXT NOT NULL,
    "loanId" TEXT,
    "employeeId" TEXT NOT NULL,
    "inspectionItemId" TEXT NOT NULL,
    "result" "InspectionResult" NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasuringInstrumentTag" (
    "id" TEXT NOT NULL,
    "measuringInstrumentId" TEXT NOT NULL,
    "rfidTagUid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasuringInstrumentTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasuringInstrument_managementNumber_key" ON "MeasuringInstrument"("managementNumber");

-- CreateIndex
CREATE INDEX "InspectionItem_measuringInstrumentId_idx" ON "InspectionItem"("measuringInstrumentId");

-- CreateIndex
CREATE INDEX "InspectionItem_order_idx" ON "InspectionItem"("order");

-- CreateIndex
CREATE INDEX "InspectionRecord_measuringInstrumentId_idx" ON "InspectionRecord"("measuringInstrumentId");

-- CreateIndex
CREATE INDEX "InspectionRecord_loanId_idx" ON "InspectionRecord"("loanId");

-- CreateIndex
CREATE INDEX "InspectionRecord_employeeId_idx" ON "InspectionRecord"("employeeId");

-- CreateIndex
CREATE INDEX "InspectionRecord_inspectionItemId_idx" ON "InspectionRecord"("inspectionItemId");

-- CreateIndex
CREATE INDEX "InspectionRecord_inspectedAt_idx" ON "InspectionRecord"("inspectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeasuringInstrumentTag_rfidTagUid_key" ON "MeasuringInstrumentTag"("rfidTagUid");

-- CreateIndex
CREATE INDEX "MeasuringInstrumentTag_measuringInstrumentId_idx" ON "MeasuringInstrumentTag"("measuringInstrumentId");

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "measuringInstrumentId" TEXT;

-- CreateIndex
CREATE INDEX "Loan_measuringInstrumentId_idx" ON "Loan"("measuringInstrumentId");

-- AddForeignKey
ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_measuringInstrumentId_fkey" FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionRecord" ADD CONSTRAINT "InspectionRecord_measuringInstrumentId_fkey" FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionRecord" ADD CONSTRAINT "InspectionRecord_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionRecord" ADD CONSTRAINT "InspectionRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionRecord" ADD CONSTRAINT "InspectionRecord_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasuringInstrumentTag" ADD CONSTRAINT "MeasuringInstrumentTag_measuringInstrumentId_fkey" FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_measuringInstrumentId_fkey" FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
