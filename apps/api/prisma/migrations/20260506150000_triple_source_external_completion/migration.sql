-- AlterTable
ALTER TABLE "ProductionScheduleExternalCompletion" ADD COLUMN     "externallyCompletedFromFkojunstDisappeared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductionScheduleExternalCompletion" ADD COLUMN     "externallyCompletedFromFkojunstMailStatus" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductionScheduleExternalCompletion" ADD COLUMN     "externallyCompletedFromScheduleCsvDisappeared" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: 旧 isExternallyCompleted は工順STメール「消滅差分」のみだった
UPDATE "ProductionScheduleExternalCompletion"
SET "externallyCompletedFromFkojunstDisappeared" = true
WHERE "isExternallyCompleted" = true;

-- CreateTable
CREATE TABLE "ProductionScheduleCsvIngestLogicalKeySnapshot" (
    "compositeKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionScheduleCsvIngestLogicalKeySnapshot_pkey" PRIMARY KEY ("compositeKey")
);
