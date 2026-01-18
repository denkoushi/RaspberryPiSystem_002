-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('SLACK', 'EMAIL', 'HTTP');

-- CreateEnum
CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" TEXT,
    "severity" "AlertSeverity",
    "message" TEXT,
    "details" JSONB,
    "source" JSONB,
    "context" JSONB,
    "fingerprint" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "channel" "AlertChannel" NOT NULL DEFAULT 'SLACK',
    "routeKey" TEXT NOT NULL,
    "status" "AlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_timestamp_idx" ON "Alert"("timestamp");

-- CreateIndex
CREATE INDEX "Alert_acknowledged_idx" ON "Alert"("acknowledged");

-- CreateIndex
CREATE INDEX "Alert_type_idx" ON "Alert"("type");

-- CreateIndex
CREATE INDEX "AlertDelivery_alertId_idx" ON "AlertDelivery"("alertId");

-- CreateIndex
CREATE INDEX "AlertDelivery_status_idx" ON "AlertDelivery"("status");

-- CreateIndex
CREATE INDEX "AlertDelivery_nextAttemptAt_idx" ON "AlertDelivery"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_channel_routeKey_status_idx" ON "AlertDelivery"("channel", "routeKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_alertId_channel_routeKey_key" ON "AlertDelivery"("alertId", "channel", "routeKey");

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
