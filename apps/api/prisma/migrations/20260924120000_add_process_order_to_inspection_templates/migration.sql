ALTER TABLE "PartMeasurementTemplate"
ADD COLUMN "fkojun" TEXT;

ALTER TABLE "PartMeasurementTemplateSiblingGroup"
ADD COLUMN "fkojun" TEXT;

ALTER TABLE "SelfInspectionSession"
ADD COLUMN "scheduleResourceCd" TEXT;

CREATE INDEX "PartMeasurementTemplate_idx_fkojun_lookup"
ON "PartMeasurementTemplate"("fhincd", "processGroup", "resourceCd", "fkojun", "isActive");

CREATE INDEX "PartMeasurementTemplateSiblingGroup_idx_fkojun"
ON "PartMeasurementTemplateSiblingGroup"("fhincd", "processGroup", "fkojun");
