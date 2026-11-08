-- AlterTable
ALTER TABLE "ProductionScheduleAccessPasswordConfig"
ADD COLUMN "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedAttemptWindowEndsAt" TIMESTAMP(3);
