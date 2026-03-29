-- Part measurement phase 2: resourceCd in template key, sheet lifecycle, edit lock, decimal places

-- AlterEnum
ALTER TYPE "PartMeasurementSheetStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PartMeasurementSheetStatus" ADD VALUE 'INVALIDATED';

-- AlterTable PartMeasurementTemplate: add resourceCd
ALTER TABLE "PartMeasurementTemplate" ADD COLUMN "resourceCd" TEXT;

UPDATE "PartMeasurementTemplate" SET "resourceCd" = '__LEGACY__' WHERE "resourceCd" IS NULL;

ALTER TABLE "PartMeasurementTemplate" ALTER COLUMN "resourceCd" SET NOT NULL;
ALTER TABLE "PartMeasurementTemplate" ALTER COLUMN "resourceCd" SET DEFAULT '__LEGACY__';

-- Drop old unique, add new unique including resourceCd
DROP INDEX IF EXISTS "PartMeasurementTemplate_unique_fhincd_group_version";

CREATE UNIQUE INDEX "PartMeasurementTemplate_unique_fhincd_group_resource_version" ON "PartMeasurementTemplate"("fhincd", "processGroup", "resourceCd", "version");

DROP INDEX IF EXISTS "PartMeasurementTemplate_idx_lookup";
CREATE INDEX "PartMeasurementTemplate_idx_lookup" ON "PartMeasurementTemplate"("fhincd", "processGroup", "resourceCd", "isActive");

-- AlterTable PartMeasurementTemplateItem
ALTER TABLE "PartMeasurementTemplateItem" ADD COLUMN "decimalPlaces" INTEGER NOT NULL DEFAULT 6;

-- AlterTable PartMeasurementSheet
ALTER TABLE "PartMeasurementSheet" ADD COLUMN "createdByEmployeeId" TEXT,
ADD COLUMN "createdByEmployeeNameSnapshot" TEXT,
ADD COLUMN "finalizedByEmployeeId" TEXT,
ADD COLUMN "finalizedByEmployeeNameSnapshot" TEXT,
ADD COLUMN "editLockClientDeviceId" TEXT,
ADD COLUMN "editLockExpiresAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "invalidatedAt" TIMESTAMP(3),
ADD COLUMN "invalidatedReason" TEXT;

-- Backfill resource snapshot for old sheets (nullable column allowed empty key — use legacy token)
UPDATE "PartMeasurementSheet" SET "resourceCdSnapshot" = COALESCE(NULLIF(TRIM("resourceCdSnapshot"), ''), '__LEGACY__')
WHERE "resourceCdSnapshot" IS NULL OR TRIM("resourceCdSnapshot") = '';

-- Partial unique: one DRAFT per business key
CREATE UNIQUE INDEX "PartMeasurementSheet_unique_draft_business_key" ON "PartMeasurementSheet" ("productNo", "processGroupSnapshot", COALESCE("resourceCdSnapshot", ''))
WHERE status = 'DRAFT';

-- Partial unique: one FINALIZED per business key (INVALIDATED/CANCELLED rows excluded)
CREATE UNIQUE INDEX "PartMeasurementSheet_unique_finalized_business_key" ON "PartMeasurementSheet" ("productNo", "processGroupSnapshot", COALESCE("resourceCdSnapshot", ''))
WHERE status = 'FINALIZED';

CREATE INDEX "PartMeasurementSheet_idx_product_group_status" ON "PartMeasurementSheet"("productNo", "processGroupSnapshot", "status");
CREATE INDEX "PartMeasurementSheet_idx_finalizedAt" ON "PartMeasurementSheet"("finalizedAt");

-- AddForeignKey
ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_finalizedByEmployeeId_fkey" FOREIGN KEY ("finalizedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_editLockClientDeviceId_fkey" FOREIGN KEY ("editLockClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
