ALTER TABLE "InventoryItem" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "InventoryItem_deletedAt_idx" ON "InventoryItem"("deletedAt");
