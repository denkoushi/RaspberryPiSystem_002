ALTER TABLE "InventoryCompartment" ADD COLUMN "lastIssuedAt" TIMESTAMP(3);

UPDATE "InventoryCompartment" AS compartment
SET "lastIssuedAt" = issues."lastIssuedAt"
FROM (
  SELECT "compartmentId", MAX("createdAt") AS "lastIssuedAt"
  FROM "InventoryTransaction"
  WHERE "action" = 'ISSUE'
  GROUP BY "compartmentId"
) AS issues
WHERE compartment."id" = issues."compartmentId";
