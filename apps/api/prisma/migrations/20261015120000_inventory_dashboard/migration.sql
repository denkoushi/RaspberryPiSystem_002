ALTER TABLE "InventoryItem" ADD COLUMN "unitPrice" INTEGER;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_unitPrice_check" CHECK ("unitPrice" BETWEEN 0 AND 10000000);
CREATE TABLE "InventoryToolValueDistinct" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "valueA" TEXT NOT NULL,
    "valueB" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryToolValueDistinct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryToolValueDistinct_field_valueA_valueB_key" ON "InventoryToolValueDistinct"("field", "valueA", "valueB");
