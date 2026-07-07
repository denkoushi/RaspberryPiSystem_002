CREATE TABLE "AssemblySerialRegistry" (
    "id" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblySerialRegistry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssemblySerialRegistry_serialNo_key" ON "AssemblySerialRegistry"("serialNo");

CREATE TABLE "AssemblyLot" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productNo" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "operatorEmployeeId" TEXT,
    "operatorNameSnapshot" TEXT NOT NULL,
    "targetUnit" TEXT NOT NULL,
    "torqueWrenchId" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyLot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssemblyLot_idx_product_updated" ON "AssemblyLot"("productNo", "updatedAt");
CREATE INDEX "AssemblyLot_idx_template_updated" ON "AssemblyLot"("templateId", "updatedAt");

CREATE TABLE "AssemblyLotSerial" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "serialRegistryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyLotSerial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssemblyLotSerial_serialRegistryId_key" ON "AssemblyLotSerial"("serialRegistryId");
CREATE UNIQUE INDEX "AssemblyLotSerial_unique_lot_sort" ON "AssemblyLotSerial"("lotId", "sortOrder");
CREATE INDEX "AssemblyLotSerial_idx_lot_sort" ON "AssemblyLotSerial"("lotId", "sortOrder");

ALTER TABLE "AssemblyWorkSession"
ADD COLUMN "serialRegistryId" TEXT,
ADD COLUMN "lotSerialId" TEXT;

UPDATE "AssemblyWorkSession"
SET "serialNo" = UPPER(BTRIM("serialNo"));

INSERT INTO "AssemblySerialRegistry" ("id", "serialNo", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."serialNo", MIN(s."createdAt"), MAX(s."updatedAt")
FROM "AssemblyWorkSession" s
WHERE BTRIM(s."serialNo") <> ''
GROUP BY s."serialNo";

UPDATE "AssemblyWorkSession" s
SET "serialRegistryId" = r."id"
FROM "AssemblySerialRegistry" r
WHERE r."serialNo" = s."serialNo";

CREATE UNIQUE INDEX "AssemblyWorkSession_serialRegistryId_key" ON "AssemblyWorkSession"("serialRegistryId");
CREATE UNIQUE INDEX "AssemblyWorkSession_lotSerialId_key" ON "AssemblyWorkSession"("lotSerialId");

ALTER TABLE "AssemblyLot"
ADD CONSTRAINT "AssemblyLot_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "AssemblyTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyLotSerial"
ADD CONSTRAINT "AssemblyLotSerial_lotId_fkey"
FOREIGN KEY ("lotId") REFERENCES "AssemblyLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyLotSerial"
ADD CONSTRAINT "AssemblyLotSerial_serialRegistryId_fkey"
FOREIGN KEY ("serialRegistryId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyWorkSession"
ADD CONSTRAINT "AssemblyWorkSession_serialRegistryId_fkey"
FOREIGN KEY ("serialRegistryId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyWorkSession"
ADD CONSTRAINT "AssemblyWorkSession_lotSerialId_fkey"
FOREIGN KEY ("lotSerialId") REFERENCES "AssemblyLotSerial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
