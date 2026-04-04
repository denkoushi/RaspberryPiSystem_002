-- Part measurement: template scope + FHINMEI candidate key; candidate-only process groups

ALTER TYPE "PartMeasurementProcessGroup" ADD VALUE 'CANDIDATE_FHINCD_RESOURCE';
ALTER TYPE "PartMeasurementProcessGroup" ADD VALUE 'CANDIDATE_FHINMEI_ONLY';

CREATE TYPE "PartMeasurementTemplateScope" AS ENUM ('THREE_KEY', 'FHINCD_RESOURCE', 'FHINMEI_ONLY');

ALTER TABLE "PartMeasurementTemplate" ADD COLUMN "templateScope" "PartMeasurementTemplateScope" NOT NULL DEFAULT 'THREE_KEY';
ALTER TABLE "PartMeasurementTemplate" ADD COLUMN "candidateFhinmei" TEXT;

CREATE INDEX "PartMeasurementTemplate_templateScope_fhincd_resourceCd_isActive_idx" ON "PartMeasurementTemplate"("templateScope", "fhincd", "resourceCd", "isActive");
