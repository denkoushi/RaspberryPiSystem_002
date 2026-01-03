-- AlterTable
ALTER TABLE "ClientDevice" ADD COLUMN "statusClientId" TEXT;

-- CreateIndex
CREATE INDEX "ClientDevice_statusClientId_idx" ON "ClientDevice"("statusClientId");

