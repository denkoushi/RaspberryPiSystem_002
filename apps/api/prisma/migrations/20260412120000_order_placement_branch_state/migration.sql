-- CreateEnum
CREATE TYPE "OrderPlacementActionType" AS ENUM ('LEGACY', 'CREATE_BRANCH', 'MOVE_BRANCH');

-- AlterTable
ALTER TABLE "OrderPlacementEvent" ADD COLUMN "branchNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderPlacementEvent" ADD COLUMN "actionType" "OrderPlacementActionType" NOT NULL DEFAULT 'LEGACY';

-- CreateTable
CREATE TABLE "OrderPlacementBranchState" (
    "id" TEXT NOT NULL,
    "manufacturingOrderBarcodeRaw" TEXT NOT NULL,
    "branchNo" INTEGER NOT NULL,
    "shelfCodeRaw" TEXT NOT NULL,
    "csvDashboardRowId" TEXT,
    "scheduleSnapshot" JSONB,
    "lastEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPlacementBranchState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderPlacementBranchState_manufacturingOrderBarcodeRaw_branchNo_key" ON "OrderPlacementBranchState"("manufacturingOrderBarcodeRaw", "branchNo");

CREATE UNIQUE INDEX "OrderPlacementBranchState_lastEventId_key" ON "OrderPlacementBranchState"("lastEventId");

CREATE INDEX "OrderPlacementBranchState_manufacturingOrderBarcodeRaw_idx" ON "OrderPlacementBranchState"("manufacturingOrderBarcodeRaw");

CREATE INDEX "OrderPlacementEvent_manufacturingOrderBarcodeRaw_branchNo_idx" ON "OrderPlacementEvent"("manufacturingOrderBarcodeRaw", "branchNo");

-- 既存履歴は branch 1・LEGACY。現在棚は各製造orderの最新イベントから投影
INSERT INTO "OrderPlacementBranchState" ("id", "manufacturingOrderBarcodeRaw", "branchNo", "shelfCodeRaw", "csvDashboardRowId", "scheduleSnapshot", "lastEventId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  e."manufacturingOrderBarcodeRaw",
  1,
  e."shelfCodeRaw",
  e."csvDashboardRowId",
  e."scheduleSnapshot",
  e."id",
  e."placedAt",
  e."placedAt"
FROM (
  SELECT DISTINCT ON ("manufacturingOrderBarcodeRaw") *
  FROM "OrderPlacementEvent"
  ORDER BY "manufacturingOrderBarcodeRaw", "placedAt" DESC
) e;
