-- Item unit (null means 個) and the list of offered units.
ALTER TABLE "InventoryItem" ADD COLUMN "unit" TEXT;

CREATE TABLE "InventoryUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryUnit_name_key" ON "InventoryUnit"("name");

INSERT INTO "InventoryUnit" ("id", "name") VALUES
    (gen_random_uuid()::text, '個'),
    (gen_random_uuid()::text, 'ケース')
ON CONFLICT ("name") DO NOTHING;
