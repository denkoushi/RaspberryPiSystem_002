ALTER TYPE "SelfInspectionInspectorMeasurementJudgementStatus"
ADD VALUE IF NOT EXISTS 'FINAL_OK';

ALTER TYPE "SelfInspectionInspectorMeasurementJudgementStatus"
ADD VALUE IF NOT EXISTS 'FINAL_NG';

ALTER TYPE "SelfInspectionMeasurementReviewStatus"
ADD VALUE IF NOT EXISTS 'REJECTED';

CREATE TYPE "SelfInspectionDecisionWorkflow" AS ENUM (
  'LEGACY_RECORD_APPROVAL',
  'INSPECTOR_FINAL_JUDGEMENT'
);

ALTER TABLE "SelfInspectionSession"
ADD COLUMN "decisionWorkflow" "SelfInspectionDecisionWorkflow" NOT NULL
DEFAULT 'LEGACY_RECORD_APPROVAL';
