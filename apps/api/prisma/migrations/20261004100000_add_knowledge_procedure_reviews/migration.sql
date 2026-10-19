-- Existing roster rows remain unchanged; rank mappings are managed through the API.
ALTER TABLE "Employee" ADD COLUMN "positionName" TEXT;

CREATE TABLE "KnowledgePositionRank" (
  "positionName" TEXT NOT NULL,
  "rank" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgePositionRank_pkey" PRIMARY KEY ("positionName"),
  CONSTRAINT "KnowledgePositionRank_rank_check" CHECK ("rank" IN ('general','leader','section_chief','manager'))
);

CREATE TABLE "KnowledgeProcedureReview" (
  "id" TEXT NOT NULL,
  "procedureId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeCodeSnapshot" TEXT NOT NULL,
  "employeeNameSnapshot" TEXT NOT NULL,
  "employeeNfcTagUidSnapshot" TEXT NOT NULL,
  "employeePositionSnapshot" TEXT,
  "employeeRankSnapshot" TEXT NOT NULL,
  "comment" TEXT,
  "actorKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeProcedureReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeProcedureReview_action_check" CHECK ("action" IN ('approved','returned','error_reported')),
  CONSTRAINT "KnowledgeProcedureReview_rank_check" CHECK ("employeeRankSnapshot" IN ('general','leader','section_chief','manager')),
  CONSTRAINT "KnowledgeProcedureReview_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "KnowledgeProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeProcedureReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "KnowledgeProcedureRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeProcedureReview_procedureId_createdAt_idx" ON "KnowledgeProcedureReview"("procedureId", "createdAt");
CREATE INDEX "KnowledgeProcedureReview_revisionId_createdAt_idx" ON "KnowledgeProcedureReview"("revisionId", "createdAt");
