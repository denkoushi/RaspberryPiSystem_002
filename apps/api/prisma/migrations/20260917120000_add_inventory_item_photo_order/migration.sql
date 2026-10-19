ALTER TABLE "InventoryItemPhoto"
ADD COLUMN "photoIndex" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "inventoryItemId" ORDER BY "createdAt" ASC, "id" ASC) AS "rank"
  FROM "InventoryItemPhoto"
)
UPDATE "InventoryItemPhoto" AS photo
SET "photoIndex" = ranked."rank"
FROM ranked
WHERE photo."id" = ranked."id";

DROP INDEX "InventoryItemPhoto_inventoryItemId_createdAt_idx";

CREATE INDEX "InventoryItemPhoto_inventoryItemId_photoIndex_createdAt_idx"
ON "InventoryItemPhoto"("inventoryItemId", "photoIndex", "createdAt");
