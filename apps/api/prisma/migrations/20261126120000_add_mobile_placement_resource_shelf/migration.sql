CREATE TABLE "MobilePlacementResourceShelf" (
    "id" TEXT NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "shelfId" TEXT,
    CONSTRAINT "MobilePlacementResourceShelf_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilePlacementResourceShelf_resourceCd_shelfId_key"
    ON "MobilePlacementResourceShelf"("resourceCd", "shelfId");
CREATE INDEX "MobilePlacementResourceShelf_shelfId_idx" ON "MobilePlacementResourceShelf"("shelfId");

ALTER TABLE "MobilePlacementResourceShelf" ADD CONSTRAINT "MobilePlacementResourceShelf_shelfId_fkey"
    FOREIGN KEY ("shelfId") REFERENCES "MobilePlacementShelf"("id") ON DELETE CASCADE ON UPDATE CASCADE;
