-- CreateTable
CREATE TABLE "BackupConfigChange" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorUsername" TEXT,
    "summary" TEXT,
    "diff" JSONB,
    "snapshotRedacted" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupConfigChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupConfigChange_createdAt_idx" ON "BackupConfigChange"("createdAt");

-- CreateIndex
CREATE INDEX "BackupConfigChange_actionType_idx" ON "BackupConfigChange"("actionType");
