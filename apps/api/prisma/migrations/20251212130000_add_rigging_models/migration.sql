-- CreateEnum
CREATE TYPE "RiggingStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "riggingGearId" TEXT;

-- CreateTable
CREATE TABLE "RiggingGear" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managementNumber" TEXT NOT NULL,
    "storageLocation" TEXT,
    "department" TEXT,
    "maxLoadTon" DOUBLE PRECISION,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "thicknessMm" INTEGER,
    "startedAt" TIMESTAMP(3),
    "status" "RiggingStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiggingGear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiggingGearTag" (
    "id" TEXT NOT NULL,
    "riggingGearId" TEXT NOT NULL,
    "rfidTagUid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiggingGearTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiggingInspectionRecord" (
    "id" TEXT NOT NULL,
    "riggingGearId" TEXT NOT NULL,
    "loanId" TEXT,
    "employeeId" TEXT NOT NULL,
    "result" "InspectionResult" NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiggingInspectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiggingGear_managementNumber_key" ON "RiggingGear"("managementNumber");

-- CreateIndex
CREATE INDEX "RiggingGearTag_riggingGearId_idx" ON "RiggingGearTag"("riggingGearId");

-- CreateIndex
CREATE UNIQUE INDEX "RiggingGearTag_rfidTagUid_key" ON "RiggingGearTag"("rfidTagUid");

-- CreateIndex
CREATE INDEX "RiggingInspectionRecord_riggingGearId_idx" ON "RiggingInspectionRecord"("riggingGearId");

-- CreateIndex
CREATE INDEX "RiggingInspectionRecord_loanId_idx" ON "RiggingInspectionRecord"("loanId");

-- CreateIndex
CREATE INDEX "RiggingInspectionRecord_employeeId_idx" ON "RiggingInspectionRecord"("employeeId");

-- CreateIndex
CREATE INDEX "RiggingInspectionRecord_inspectedAt_idx" ON "RiggingInspectionRecord"("inspectedAt");

-- CreateIndex
CREATE INDEX "Loan_riggingGearId_idx" ON "Loan"("riggingGearId");

-- AddForeignKey
ALTER TABLE "RiggingGearTag" ADD CONSTRAINT "RiggingGearTag_riggingGearId_fkey" FOREIGN KEY ("riggingGearId") REFERENCES "RiggingGear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiggingInspectionRecord" ADD CONSTRAINT "RiggingInspectionRecord_riggingGearId_fkey" FOREIGN KEY ("riggingGearId") REFERENCES "RiggingGear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiggingInspectionRecord" ADD CONSTRAINT "RiggingInspectionRecord_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiggingInspectionRecord" ADD CONSTRAINT "RiggingInspectionRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_riggingGearId_fkey" FOREIGN KEY ("riggingGearId") REFERENCES "RiggingGear"("id") ON DELETE SET NULL ON UPDATE CASCADE;
