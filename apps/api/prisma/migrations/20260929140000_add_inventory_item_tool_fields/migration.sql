-- Tool information for inventory items (all optional).
ALTER TABLE "InventoryItem" ADD COLUMN "maker" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "toolName" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "workMaterial" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "toolSize" TEXT;
