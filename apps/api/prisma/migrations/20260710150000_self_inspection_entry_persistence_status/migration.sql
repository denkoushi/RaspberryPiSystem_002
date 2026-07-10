-- CreateEnum
CREATE TYPE "SelfInspectionEntryPersistenceStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- AlterTable
ALTER TABLE "SelfInspectionLotEntry"
ADD COLUMN "persistenceStatus" "SelfInspectionEntryPersistenceStatus" NOT NULL DEFAULT 'CONFIRMED';

-- Backfill existing rows explicitly
UPDATE "SelfInspectionLotEntry"
SET "persistenceStatus" = 'CONFIRMED';

-- CreateIndex
CREATE INDEX "SelfInspectionLotEntry_idx_session_persistence"
ON "SelfInspectionLotEntry"("sessionId", "persistenceStatus");
