CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "PartMeasurementVisualTemplate"
  ADD COLUMN "searchDigits" TEXT;

UPDATE "PartMeasurementVisualTemplate"
SET "searchDigits" = regexp_replace("name", '[^0-9]', '', 'g');

ALTER TABLE "PartMeasurementVisualTemplate"
  ALTER COLUMN "searchDigits" SET NOT NULL;

ALTER TABLE "PartMeasurementVisualTemplate"
  ADD CONSTRAINT "PartMeasurementVisualTemplate_searchDigits_matches_name_chk"
  CHECK ("searchDigits" = regexp_replace("name", '[^0-9]', '', 'g'));

CREATE INDEX "PartMeasurementVisualTemplate_searchDigits_trgm_idx"
  ON "PartMeasurementVisualTemplate"
  USING GIN ("searchDigits" gin_trgm_ops);
