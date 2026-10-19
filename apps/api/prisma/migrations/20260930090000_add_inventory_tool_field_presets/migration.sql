-- Pre-registered choices for inventory tool fields.
CREATE TABLE "InventoryToolFieldPreset" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryToolFieldPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryToolFieldPreset_field_value_key" ON "InventoryToolFieldPreset"("field", "value");
