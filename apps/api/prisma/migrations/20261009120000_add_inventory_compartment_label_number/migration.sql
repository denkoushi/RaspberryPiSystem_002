CREATE SEQUENCE "InventoryCompartment_labelNumber_seq" AS INTEGER;
ALTER TABLE "InventoryCompartment" ADD COLUMN "labelNumber" INTEGER;

UPDATE "InventoryCompartment" AS compartment
SET "labelNumber" = numbered."labelNumber"
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::INTEGER AS "labelNumber"
  FROM "InventoryCompartment"
) AS numbered
WHERE compartment."id" = numbered."id";

SELECT setval(
  '"InventoryCompartment_labelNumber_seq"',
  COALESCE(MAX("labelNumber"), 1),
  MAX("labelNumber") IS NOT NULL
) FROM "InventoryCompartment";

ALTER TABLE "InventoryCompartment"
  ALTER COLUMN "labelNumber" SET NOT NULL,
  ALTER COLUMN "labelNumber" SET DEFAULT nextval('"InventoryCompartment_labelNumber_seq"');
ALTER SEQUENCE "InventoryCompartment_labelNumber_seq" OWNED BY "InventoryCompartment"."labelNumber";
CREATE UNIQUE INDEX "InventoryCompartment_labelNumber_key" ON "InventoryCompartment"("labelNumber");
