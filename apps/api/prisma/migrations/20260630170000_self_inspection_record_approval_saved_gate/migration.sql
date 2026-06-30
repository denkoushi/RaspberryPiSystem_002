ALTER TABLE "SelfInspectionSession"
ADD COLUMN "recordApprovalWorkflowStartedAt" TIMESTAMP(3);

UPDATE "SelfInspectionSession"
SET "recordApprovalWorkflowStartedAt" = "recordApprovalRequiredAt"
WHERE "recordApprovalRequiredAt" IS NOT NULL;

UPDATE "SelfInspectionSession" s
SET "recordApprovalRequiredAt" = NULL
WHERE s."recordApprovalWorkflowStartedAt" IS NOT NULL
  AND s."completedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "SelfInspectionRecordApproval" a
    WHERE a."sessionId" = s."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "SelfInspectionLotEntry" e
    JOIN "SelfInspectionMeasurementValue" v ON v."entryId" = e."id"
    WHERE e."sessionId" = s."id"
  );

CREATE INDEX "SelfInspectionSession_idx_record_approval_workflow_started_at"
ON "SelfInspectionSession"("recordApprovalWorkflowStartedAt");
