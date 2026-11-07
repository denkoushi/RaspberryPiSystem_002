CREATE TABLE "ProductionScheduleSessakuPieceAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "siteKey" TEXT,
    "actorClientDeviceId" TEXT,
    "actorDeviceName" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "httpStatus" INTEGER NOT NULL,
    "message" TEXT,
    "fseiban" TEXT,
    "parentItemId" TEXT,
    "pieceIds" JSONB NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "expectedVersion" INTEGER,
    "itemRevision" TEXT,
    "itemRevisions" JSONB NOT NULL,
    "resultVersion" INTEGER,
    CONSTRAINT "ProductionScheduleSessakuPieceAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SessakuPieceAudit_parent_created_idx" ON "ProductionScheduleSessakuPieceAuditLog"("parentItemId", "createdAt");
CREATE INDEX "ProductionScheduleSessakuPieceAuditLog_requestId_idx" ON "ProductionScheduleSessakuPieceAuditLog"("requestId");
CREATE INDEX "ProductionScheduleSessakuPieceAuditLog_createdAt_idx" ON "ProductionScheduleSessakuPieceAuditLog"("createdAt");
