ALTER TABLE "InventoryImportMessage" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "InventoryToolFieldPreset" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'default';
DROP INDEX "InventoryToolFieldPreset_field_value_key";
CREATE UNIQUE INDEX "InventoryToolFieldPreset_scope_field_value_key" ON "InventoryToolFieldPreset"("scope", "field", "value");
