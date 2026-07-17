ALTER TABLE "SelfInspectionSession"
ADD COLUMN "decisionWorkflow" TEXT;

ALTER TABLE "SelfInspectionMeasurementValue"
ADD COLUMN "finalReviewStatus" TEXT;

ALTER TABLE "SelfInspectionInspectorMeasurementValue"
ADD COLUMN "finalJudgementStatus" TEXT;
