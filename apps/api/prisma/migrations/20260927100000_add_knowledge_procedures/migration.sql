-- CreateTable
CREATE TABLE "KnowledgeProcedure" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "partNumber" TEXT,
    "drawingNumber" TEXT,
    "processName" TEXT,
    "reviewTier" TEXT NOT NULL,
    "publishedRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeProcedureRevision" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdByKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeProcedureRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeProcedure_publishedRevisionId_key" ON "KnowledgeProcedure"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "KnowledgeProcedure_partNumber_idx" ON "KnowledgeProcedure"("partNumber");

-- CreateIndex
CREATE INDEX "KnowledgeProcedure_drawingNumber_idx" ON "KnowledgeProcedure"("drawingNumber");

-- CreateIndex
CREATE INDEX "KnowledgeProcedureRevision_state_createdAt_idx" ON "KnowledgeProcedureRevision"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeProcedureRevision_procedureId_revisionNumber_key" ON "KnowledgeProcedureRevision"("procedureId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "KnowledgeProcedure" ADD CONSTRAINT "KnowledgeProcedure_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "KnowledgeProcedureRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeProcedureRevision" ADD CONSTRAINT "KnowledgeProcedureRevision_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "KnowledgeProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Value domains mirror `apps/api/src/services/knowledge/procedure-content.ts`.
ALTER TABLE "KnowledgeProcedure" ADD CONSTRAINT "KnowledgeProcedure_reviewTier_check"
  CHECK ("reviewTier" IN ('approval_required','auto_publish'));
ALTER TABLE "KnowledgeProcedureRevision" ADD CONSTRAINT "KnowledgeProcedureRevision_state_check"
  CHECK ("state" IN ('draft','pending_approval','published','returned','superseded'));
ALTER TABLE "KnowledgeProcedureRevision" ADD CONSTRAINT "KnowledgeProcedureRevision_revisionNumber_check"
  CHECK ("revisionNumber" >= 1);
