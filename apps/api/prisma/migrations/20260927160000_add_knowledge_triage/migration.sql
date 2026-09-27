-- Expand-only: one nullable column per ALTER, constraints only on tables created here.
ALTER TABLE "KnowledgeIntake" ADD COLUMN "posterEmployeeId" TEXT;
ALTER TABLE "KnowledgeIntake" ADD COLUMN "posterNameSnapshot" TEXT;
ALTER TABLE "KnowledgeIntake" ADD COLUMN "scannedPartNumber" TEXT;

ALTER TABLE "KnowledgeProcedure" ADD COLUMN "target" TEXT;
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "workType" TEXT;
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "detail" TEXT;
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "buildRequestedAt" TIMESTAMP(3);
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "buildLeaseToken" TEXT;
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "buildLeaseUntil" TIMESTAMP(3);
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "buildAttempts" INTEGER;
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "buildRetryAt" TIMESTAMP(3);
ALTER TABLE "KnowledgeProcedure" ADD COLUMN "buildErrorCode" TEXT;

-- State domain mirrors `apps/api/src/services/knowledge/triage.port.ts`.
CREATE TABLE "KnowledgeTriage" (
    "intakeId" TEXT NOT NULL,
    "posterEmployeeId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'suggesting',
    "suggestions" JSONB,
    "decidedProcedureId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeTriage_pkey" PRIMARY KEY ("intakeId"),
    CONSTRAINT "KnowledgeTriage_state_check" CHECK ("state" IN ('suggesting','awaiting','decided'))
);

-- Rows are seeded at application start (`ensureKnowledgeReferenceData`), not by this migration.
CREATE TABLE "KnowledgeWorkType" (
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeWorkType_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "KnowledgeTriage_state_retryAt_createdAt_idx" ON "KnowledgeTriage"("state", "retryAt", "createdAt");
CREATE INDEX "KnowledgeTriage_posterEmployeeId_state_createdAt_idx" ON "KnowledgeTriage"("posterEmployeeId", "state", "createdAt");
CREATE INDEX "KnowledgeProcedure_buildRequestedAt_idx" ON "KnowledgeProcedure"("buildRequestedAt");
