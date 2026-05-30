-- AlterTable
ALTER TABLE "PartMeasurementTemplateItem" ADD COLUMN "markerXRatio" DECIMAL(10,8),
ADD COLUMN "markerYRatio" DECIMAL(10,8),
ADD COLUMN "nominalValue" DECIMAL(18,6),
ADD COLUMN "lowerLimit" DECIMAL(18,6),
ADD COLUMN "upperLimit" DECIMAL(18,6);
