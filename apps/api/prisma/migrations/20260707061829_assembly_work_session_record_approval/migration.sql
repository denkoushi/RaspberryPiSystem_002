-- 組立キオスク記録確認: 完了した組立作業セッションへのNFC承認を記録する
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

CREATE UNIQUE INDEX "AssemblyWorkSessionApproval_sessionId_key" ON "AssemblyWorkSessionApproval"("sessionId");

CREATE INDEX "AssemblyWorkSessionApproval_idx_approved_at" ON "AssemblyWorkSessionApproval"("approvedAt");

CREATE INDEX "AssemblyWorkSessionApproval_idx_approver_employee" ON "AssemblyWorkSessionApproval"("approverEmployeeId");

CREATE INDEX "AssemblyWorkSessionApproval_idx_client_device" ON "AssemblyWorkSessionApproval"("clientDeviceId");

ALTER TABLE "AssemblyWorkSessionApproval" ADD CONSTRAINT "AssemblyWorkSessionApproval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyWorkSessionApproval" ADD CONSTRAINT "AssemblyWorkSessionApproval_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssemblyWorkSessionApproval" ADD CONSTRAINT "AssemblyWorkSessionApproval_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
