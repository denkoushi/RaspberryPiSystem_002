-- CreateEnum
CREATE TYPE "BackupFileStatus" AS ENUM ('EXISTS', 'DELETED');

-- AlterTable
ALTER TABLE "BackupHistory" ADD COLUMN     "fileStatus" "BackupFileStatus" NOT NULL DEFAULT 'EXISTS';

-- CreateIndex
CREATE INDEX "BackupHistory_fileStatus_idx" ON "BackupHistory"("fileStatus");
