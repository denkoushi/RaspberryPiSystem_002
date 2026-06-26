-- AlterTable
ALTER TABLE "SelfInspectionSession"
ADD COLUMN "recordApprovalRequiredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SelfInspectionRecordApproval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approverEmployeeId" TEXT,
    "approverEmployeeCodeSnapshot" TEXT NOT NULL,
    "approverEmployeeNameSnapshot" TEXT NOT NULL,
    "approverEmployeeNfcTagUidSnapshot" TEXT NOT NULL,
    "comment" TEXT,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionRecordApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionRecordApproval_sessionId_key" ON "SelfInspectionRecordApproval"("sessionId");

-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_record_approval_required_at" ON "SelfInspectionSession"("recordApprovalRequiredAt");

-- CreateIndex
CREATE INDEX "SelfInspectionRecordApproval_idx_approved_at" ON "SelfInspectionRecordApproval"("approvedAt");

-- CreateIndex
CREATE INDEX "SelfInspectionRecordApproval_idx_approver_employee" ON "SelfInspectionRecordApproval"("approverEmployeeId");

-- CreateIndex
CREATE INDEX "SelfInspectionRecordApproval_idx_client_device" ON "SelfInspectionRecordApproval"("clientDeviceId");

-- AddForeignKey
ALTER TABLE "SelfInspectionRecordApproval" ADD CONSTRAINT "SelfInspectionRecordApproval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionRecordApproval" ADD CONSTRAINT "SelfInspectionRecordApproval_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionRecordApproval" ADD CONSTRAINT "SelfInspectionRecordApproval_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
