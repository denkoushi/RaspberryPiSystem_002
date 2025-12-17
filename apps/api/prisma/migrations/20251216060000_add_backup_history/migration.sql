-- CreateEnum
CREATE TYPE "BackupOperationType" AS ENUM ('BACKUP', 'RESTORE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "BackupHistory" (
    "id" TEXT NOT NULL,
    "operationType" "BackupOperationType" NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetSource" TEXT NOT NULL,
    "backupPath" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "sizeBytes" INTEGER,
    "hash" TEXT,
    "summary" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupHistory_operationType_idx" ON "BackupHistory"("operationType");

-- CreateIndex
CREATE INDEX "BackupHistory_targetKind_idx" ON "BackupHistory"("targetKind");

-- CreateIndex
CREATE INDEX "BackupHistory_status_idx" ON "BackupHistory"("status");

-- CreateIndex
CREATE INDEX "BackupHistory_startedAt_idx" ON "BackupHistory"("startedAt");

-- CreateIndex
CREATE INDEX "BackupHistory_completedAt_idx" ON "BackupHistory"("completedAt");
