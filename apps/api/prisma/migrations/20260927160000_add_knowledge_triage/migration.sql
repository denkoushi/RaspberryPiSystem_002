-- AlterTable
ALTER TABLE "KnowledgeIntake" ADD COLUMN     "posterEmployeeId" TEXT,
ADD COLUMN     "posterNameSnapshot" TEXT,
ADD COLUMN     "scannedPartNumber" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeProcedure" ADD COLUMN     "buildAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "buildErrorCode" TEXT,
ADD COLUMN     "buildLeaseToken" TEXT,
ADD COLUMN     "buildLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "buildRequestedAt" TIMESTAMP(3),
ADD COLUMN     "buildRetryAt" TIMESTAMP(3),
ADD COLUMN     "detail" TEXT,
ADD COLUMN     "target" TEXT,
ADD COLUMN     "workType" TEXT;

-- CreateTable
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

    CONSTRAINT "KnowledgeTriage_pkey" PRIMARY KEY ("intakeId")
);

-- CreateTable
CREATE TABLE "KnowledgeWorkType" (
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeWorkType_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "KnowledgeTriage_state_retryAt_createdAt_idx" ON "KnowledgeTriage"("state", "retryAt", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeTriage_posterEmployeeId_state_createdAt_idx" ON "KnowledgeTriage"("posterEmployeeId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeProcedure_buildRequestedAt_idx" ON "KnowledgeProcedure"("buildRequestedAt");


-- Value domain mirrors `apps/api/src/services/knowledge/triage.port.ts`.
ALTER TABLE "KnowledgeTriage" ADD CONSTRAINT "KnowledgeTriage_state_check"
  CHECK ("state" IN ('suggesting','awaiting','decided'));

-- Initial work types (owner-approved draft, 2026-09-27).
INSERT INTO "KnowledgeWorkType" ("name", "sortOrder") VALUES
  ('段取り', 10), ('切削条件', 20), ('加工手順', 30), ('検査・測定', 40), ('組立', 50), ('治具・工具', 60),
  ('保全・点検', 70), ('安全', 80), ('申し込み・手続き', 90), ('教育・技能', 100), ('その他', 1000);

-- Posts queued before triage existed get a triage row without a poster (decided later by a team leader).
INSERT INTO "KnowledgeTriage" ("intakeId", "state", "updatedAt")
SELECT DISTINCT m."intakeId", 'suggesting', CURRENT_TIMESTAMP FROM "KnowledgeProcedureMaterial" m
WHERE m."state" IN ('pending', 'failed') AND m."intakeId" <> 'legacy-ready'
ON CONFLICT DO NOTHING;
