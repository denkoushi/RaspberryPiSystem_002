-- CreateEnum
CREATE TYPE "SelfInspectionChangePointKind" AS ENUM ('TOOL_CHANGE', 'SETUP_CHANGE', 'MATERIAL_LOT', 'MACHINE_REPAIR', 'PROGRAM_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "SelfInspectionLevelDecisionDirection" AS ENUM ('REDUCE', 'RESTORE');

-- CreateTable
CREATE TABLE "SelfInspectionReductionPolicyConfig" (
    "key" VARCHAR(80) NOT NULL,
    "cpkThreshold" DECIMAL(4,2) NOT NULL DEFAULT 1.67,
    "requiredConsecutiveLots" INTEGER NOT NULL DEFAULT 10,
    "minimumSampleCount" INTEGER NOT NULL DEFAULT 30,
    "resetStreakOnChangePoint" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionReductionPolicyConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SelfInspectionReductionApprover" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeCodeSnapshot" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "addedBy" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionReductionApprover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionChangePoint" (
    "id" TEXT NOT NULL,
    "fhincd" TEXT NOT NULL,
    "processGroup" "PartMeasurementProcessGroup" NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "kind" "SelfInspectionChangePointKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByEmployeeId" TEXT,
    "recordedByEmployeeCodeSnapshot" TEXT NOT NULL,
    "recordedByEmployeeNameSnapshot" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionChangePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionLevelDecision" (
    "id" TEXT NOT NULL,
    "fhincd" TEXT NOT NULL,
    "processGroup" "PartMeasurementProcessGroup" NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "templateIdSnapshot" TEXT,
    "templateVersionSnapshot" INTEGER,
    "direction" "SelfInspectionLevelDecisionDirection" NOT NULL,
    "fromMode" "SelfInspectionMode" NOT NULL,
    "fromFixedCount" INTEGER,
    "toMode" "SelfInspectionMode" NOT NULL,
    "toFixedCount" INTEGER,
    "cpkThreshold" DECIMAL(4,2) NOT NULL,
    "metricsSnapshot" JSONB NOT NULL,
    "approverEmployeeId" TEXT,
    "approverEmployeeCodeSnapshot" TEXT NOT NULL,
    "approverEmployeeNameSnapshot" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionLevelDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionReductionApprover_employeeId_key" ON "SelfInspectionReductionApprover"("employeeId");

-- CreateIndex
CREATE INDEX "SelfInspectionChangePoint_idx_key_occurred" ON "SelfInspectionChangePoint"("fhincd", "processGroup", "resourceCd", "occurredAt");

-- CreateIndex
CREATE INDEX "SelfInspectionLevelDecision_idx_key_decided" ON "SelfInspectionLevelDecision"("fhincd", "processGroup", "resourceCd", "decidedAt");

-- AddForeignKey
ALTER TABLE "SelfInspectionReductionApprover" ADD CONSTRAINT "SelfInspectionReductionApprover_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

