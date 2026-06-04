-- CreateTable
CREATE TABLE "SelfInspectionSessionResetAuditLog" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "scheduleRowId" TEXT,
    "productNo" TEXT NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "fhincd" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "nextTemplateId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorUsername" TEXT,
    "authMode" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "clientDeviceName" TEXT,
    "requestId" TEXT NOT NULL,
    "reason" TEXT,
    "completedAtWasSet" BOOLEAN NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "valueCount" INTEGER NOT NULL,
    "sessionSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionSessionResetAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SelfInspectionSessionResetAuditLog_idx_session" ON "SelfInspectionSessionResetAuditLog"("sessionId");

-- CreateIndex
CREATE INDEX "SelfInspectionSessionResetAuditLog_idx_schedule_row" ON "SelfInspectionSessionResetAuditLog"("scheduleRowId");

-- CreateIndex
CREATE INDEX "SelfInspectionSessionResetAuditLog_idx_created_at" ON "SelfInspectionSessionResetAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SelfInspectionSessionResetAuditLog_idx_action_type" ON "SelfInspectionSessionResetAuditLog"("actionType");
