CREATE TYPE "PartMeasurementToleranceKind" AS ENUM ('DIMENSION', 'GEOMETRIC');

CREATE TABLE "PartMeasurementInspectionLabelSetting" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "toleranceKind" "PartMeasurementToleranceKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMeasurementInspectionLabelSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartMeasurementInspectionLabelSetting_label_key"
    ON "PartMeasurementInspectionLabelSetting"("label");

CREATE INDEX "PMInspectionLabelSetting_idx_kind_label"
    ON "PartMeasurementInspectionLabelSetting"("toleranceKind", "label");
