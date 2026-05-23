-- AlterTable ClientDevice
ALTER TABLE "ClientDevice" ADD COLUMN "shelfLayoutEditEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable MobilePlacementShelf
ALTER TABLE "MobilePlacementShelf" ADD COLUMN "displayLabel" TEXT;
ALTER TABLE "MobilePlacementShelf" ADD COLUMN "tier" INTEGER;
ALTER TABLE "MobilePlacementShelf" ADD COLUMN "macroZoneId" TEXT;

-- CreateEnum
CREATE TYPE "MobilePlacementLayoutEntityKind" AS ENUM ('MACHINE', 'SHELF', 'AISLE', 'UNUSED');

-- CreateTable MobilePlacementZoneLayout
CREATE TABLE "MobilePlacementZoneLayout" (
    "id" TEXT NOT NULL,
    "macroZoneId" TEXT NOT NULL,
    "gridSize" INTEGER NOT NULL DEFAULT 3,
    "nextShelfSlot" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobilePlacementZoneLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable MobilePlacementLayoutEntity
CREATE TABLE "MobilePlacementLayoutEntity" (
    "id" TEXT NOT NULL,
    "zoneLayoutId" TEXT NOT NULL,
    "entityKind" "MobilePlacementLayoutEntityKind" NOT NULL,
    "cellIndices" JSONB NOT NULL,
    "resourceCd" TEXT,
    "resourceName" TEXT,
    "shelfId" TEXT,
    "aisleLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobilePlacementLayoutEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobilePlacementZoneLayout_macroZoneId_key" ON "MobilePlacementZoneLayout"("macroZoneId");
CREATE INDEX "MobilePlacementLayoutEntity_zoneLayoutId_idx" ON "MobilePlacementLayoutEntity"("zoneLayoutId");
CREATE INDEX "MobilePlacementLayoutEntity_shelfId_idx" ON "MobilePlacementLayoutEntity"("shelfId");

-- AddForeignKey
ALTER TABLE "MobilePlacementLayoutEntity" ADD CONSTRAINT "MobilePlacementLayoutEntity_zoneLayoutId_fkey" FOREIGN KEY ("zoneLayoutId") REFERENCES "MobilePlacementZoneLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobilePlacementLayoutEntity" ADD CONSTRAINT "MobilePlacementLayoutEntity_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "MobilePlacementShelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed 9 macro zone layouts
INSERT INTO "MobilePlacementZoneLayout" ("id", "macroZoneId", "gridSize", "nextShelfSlot", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'nw', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'n', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ne', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'w', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'c', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'e', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sw', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 's', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'se', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Backfill macroZoneId on existing shelves from structured shelfCodeRaw
UPDATE "MobilePlacementShelf" AS m
SET "macroZoneId" = CASE
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '西' AND split_part(m."shelfCodeRaw", '-', 2) = '北' THEN 'nw'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '西' AND split_part(m."shelfCodeRaw", '-', 2) = '中央' THEN 'w'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '西' AND split_part(m."shelfCodeRaw", '-', 2) = '南' THEN 'sw'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '中央' AND split_part(m."shelfCodeRaw", '-', 2) = '北' THEN 'n'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '中央' AND split_part(m."shelfCodeRaw", '-', 2) = '中央' THEN 'c'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '中央' AND split_part(m."shelfCodeRaw", '-', 2) = '南' THEN 's'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '東' AND split_part(m."shelfCodeRaw", '-', 2) = '北' THEN 'ne'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '東' AND split_part(m."shelfCodeRaw", '-', 2) = '中央' THEN 'e'
  WHEN split_part(m."shelfCodeRaw", '-', 1) = '東' AND split_part(m."shelfCodeRaw", '-', 2) = '南' THEN 'se'
  ELSE NULL
END
WHERE m."macroZoneId" IS NULL;
