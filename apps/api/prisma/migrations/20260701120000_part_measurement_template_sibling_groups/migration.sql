CREATE TABLE "PartMeasurementTemplateSiblingGroup" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "fhincd" TEXT NOT NULL,
  "processGroup" "PartMeasurementProcessGroup" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartMeasurementTemplateSiblingGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PartMeasurementTemplate" ADD COLUMN "siblingGroupId" TEXT;

CREATE INDEX "PartMeasurementTemplateSiblingGroup_idx_key"
  ON "PartMeasurementTemplateSiblingGroup"("fhincd", "processGroup");

CREATE INDEX "PartMeasurementTemplate_idx_sibling_active"
  ON "PartMeasurementTemplate"("siblingGroupId", "isActive");

ALTER TABLE "PartMeasurementTemplate"
  ADD CONSTRAINT "PartMeasurementTemplate_siblingGroupId_fkey"
  FOREIGN KEY ("siblingGroupId")
  REFERENCES "PartMeasurementTemplateSiblingGroup"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
