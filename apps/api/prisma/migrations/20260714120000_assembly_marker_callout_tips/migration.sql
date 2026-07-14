-- Optional callout tips for assembly bolt and check markers.
ALTER TABLE "AssemblyTemplateBolt"
  ADD COLUMN "calloutTipXRatio" DECIMAL(10,8),
  ADD COLUMN "calloutTipYRatio" DECIMAL(10,8);

ALTER TABLE "AssemblyTemplateCheckItem"
  ADD COLUMN "calloutTipXRatio" DOUBLE PRECISION,
  ADD COLUMN "calloutTipYRatio" DOUBLE PRECISION;
