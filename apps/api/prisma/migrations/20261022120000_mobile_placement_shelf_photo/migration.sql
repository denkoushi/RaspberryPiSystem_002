CREATE TABLE "MobilePlacementShelfPhoto" (
    "shelfId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByClientDeviceId" TEXT,
    CONSTRAINT "MobilePlacementShelfPhoto_pkey" PRIMARY KEY ("shelfId")
);

ALTER TABLE "MobilePlacementShelfPhoto" ADD CONSTRAINT "MobilePlacementShelfPhoto_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "MobilePlacementShelf"("id") ON DELETE CASCADE ON UPDATE CASCADE;
