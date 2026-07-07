/*
  Warnings:

  - You are about to drop the `photo_tool_similarity_gallery` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "photo_tool_similarity_gallery" DROP CONSTRAINT "photo_tool_similarity_gallery_loanId_fkey";

-- DropIndex
DROP INDEX "ProductionScheduleResourceMaster_idx_group_cd";

-- DropIndex
DROP INDEX "SelfInspectionSession_idx_completed_at_updated_at";

-- AlterTable
ALTER TABLE "GmailRateLimitState" ALTER COLUMN "cooldownUntil" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "last429At" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartMeasurementTemplate" ALTER COLUMN "resourceCd" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductionScheduleSeibanProcessingDueDate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "photo_tool_similarity_gallery";

-- CreateTable
CREATE TABLE "AssemblyWorkSessionApproval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approverEmployeeId" TEXT,
    "approverEmployeeCodeSnapshot" TEXT NOT NULL,
    "approverEmployeeNameSnapshot" TEXT NOT NULL,
    "approverNfcTagUidSnapshot" TEXT NOT NULL,
    "comment" TEXT,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyWorkSessionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyWorkSessionApproval_sessionId_key" ON "AssemblyWorkSessionApproval"("sessionId");

-- CreateIndex
CREATE INDEX "AssemblyWorkSessionApproval_idx_approved_at" ON "AssemblyWorkSessionApproval"("approvedAt");

-- CreateIndex
CREATE INDEX "AssemblyWorkSessionApproval_idx_approver_employee" ON "AssemblyWorkSessionApproval"("approverEmployeeId");

-- CreateIndex
CREATE INDEX "AssemblyWorkSessionApproval_idx_client_device" ON "AssemblyWorkSessionApproval"("clientDeviceId");

-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_completed_at_updated_at" ON "SelfInspectionSession"("completedAt", "updatedAt");

-- RenameForeignKey
ALTER TABLE "ProductionScheduleProcessChangeResidualEvidence" RENAME CONSTRAINT "ProductionScheduleProcessChangeResidualEvidence_sourceCsvDashbo" TO "ProductionScheduleProcessChangeResidualEvidence_sourceCsvD_fkey";

-- RenameForeignKey
ALTER TABLE "SelfInspectionInspectorEntryInstrumentUsage" RENAME CONSTRAINT "SelfInspectionInspectorEntryInstrumentUsage_measuringInstrument" TO "SelfInspectionInspectorEntryInstrumentUsage_measuringInstr_fkey";

-- RenameForeignKey
ALTER TABLE "SelfInspectionInspectorMeasurementValue" RENAME CONSTRAINT "SelfInspectionInspectorMeasurementValue_operatorMeasurementValu" TO "SelfInspectionInspectorMeasurementValue_operatorMeasuremen_fkey";

-- RenameForeignKey
ALTER TABLE "SelfInspectionLotEntryInstrumentUsage" RENAME CONSTRAINT "SelfInspectionLotEntryInstrumentUsage_measuringInstrumentId_fke" TO "SelfInspectionLotEntryInstrumentUsage_measuringInstrumentI_fkey";

-- AddForeignKey
ALTER TABLE "AssemblyWorkSessionApproval" ADD CONSTRAINT "AssemblyWorkSessionApproval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyWorkSessionApproval" ADD CONSTRAINT "AssemblyWorkSessionApproval_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyWorkSessionApproval" ADD CONSTRAINT "AssemblyWorkSessionApproval_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "OrderPlacementBranchState_manufacturingOrderBarcodeRaw_branchNo" RENAME TO "OrderPlacementBranchState_manufacturingOrderBarcodeRaw_bran_key";

-- RenameIndex
ALTER INDEX "PartMeasurementTemplate_templateScope_fhincd_resourceCd_isActiv" RENAME TO "PartMeasurementTemplate_templateScope_fhincd_resourceCd_isA_idx";

-- RenameIndex
ALTER INDEX "ProductionScheduleDueManagementTuningStableSnapshot_csvDashboar" RENAME TO "ProductionScheduleDueManagementTuningStableSnapshot_csvDash_key";

-- RenameIndex
ALTER INDEX "ProductionScheduleExternalCompletion_csvDashboardId_isExternall" RENAME TO "ProductionScheduleExternalCompletion_csvDashboardId_isExter_idx";

-- RenameIndex
ALTER INDEX "ProductionScheduleManualOrderResourceAssignment_csvDashboardId_" RENAME TO "ProductionScheduleManualOrderResourceAssignment_csvDashboar_idx";

-- RenameIndex
ALTER INDEX "ProductionSchedulePartPriority_csvDashboardId_location_fseiban_" RENAME TO "ProductionSchedulePartPriority_csvDashboardId_location_fsei_idx";
