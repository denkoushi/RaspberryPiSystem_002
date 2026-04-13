-- CreateTable
CREATE TABLE "MobilePlacementShelf" (
    "id" TEXT NOT NULL,
    "shelfCodeRaw" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByClientDeviceId" TEXT,

    CONSTRAINT "MobilePlacementShelf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobilePlacementShelf_shelfCodeRaw_key" ON "MobilePlacementShelf"("shelfCodeRaw");

-- AddForeignKey
ALTER TABLE "MobilePlacementShelf" ADD CONSTRAINT "MobilePlacementShelf_createdByClientDeviceId_fkey" FOREIGN KEY ("createdByClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: 既存の配膳履歴に出た棚番を棚マスタへ移行（重複は無視）
INSERT INTO "MobilePlacementShelf" ("id", "shelfCodeRaw", "createdAt", "createdByClientDeviceId")
SELECT gen_random_uuid()::text, s."shelfCodeRaw", MIN(s."createdAt"), NULL
FROM "OrderPlacementEvent" s
GROUP BY s."shelfCodeRaw"
ON CONFLICT ("shelfCodeRaw") DO NOTHING;
