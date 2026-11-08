CREATE TABLE "ProductionScheduleDueDateAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorClientDeviceId" TEXT,
    "actorDeviceName" TEXT,
    "location" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "csvDashboardRowId" TEXT,
    "fseiban" TEXT,
    "processingType" TEXT,
    "beforeDueDate" DATE,
    "afterDueDate" DATE,
    CONSTRAINT "ProductionScheduleDueDateAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionScheduleDueDateAuditLog_createdAt_idx" ON "ProductionScheduleDueDateAuditLog"("createdAt");
CREATE INDEX "ProductionScheduleDueDateAuditLog_csvDashboardRowId_createdAt_idx" ON "ProductionScheduleDueDateAuditLog"("csvDashboardRowId", "createdAt");
CREATE INDEX "ProductionScheduleDueDateAuditLog_target_idx" ON "ProductionScheduleDueDateAuditLog"("fseiban", "processingType", "createdAt");
