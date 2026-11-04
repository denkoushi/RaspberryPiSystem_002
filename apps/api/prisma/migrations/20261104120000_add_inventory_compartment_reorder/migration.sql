-- AlterTable
ALTER TABLE "InventoryCompartment" ADD COLUMN "reorderPoint" INTEGER;

ALTER TABLE "InventoryCompartment" ADD COLUMN "reorderedAt" TIMESTAMP(3);
