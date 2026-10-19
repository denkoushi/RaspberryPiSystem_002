-- CreateTable
CREATE TABLE "KnowledgeProcedureMaterial" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "organized" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "procedureId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeProcedureMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeProcedureMaterial_sourceId_key" ON "KnowledgeProcedureMaterial"("sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeProcedureMaterial_state_retryAt_createdAt_idx" ON "KnowledgeProcedureMaterial"("state", "retryAt", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeProcedureMaterial_procedureId_createdAt_idx" ON "KnowledgeProcedureMaterial"("procedureId", "createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeProcedureMaterial" ADD CONSTRAINT "KnowledgeProcedureMaterial_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "KnowledgeProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Value domain mirrors `apps/api/src/services/knowledge/procedure-material.port.ts`.
ALTER TABLE "KnowledgeProcedureMaterial" ADD CONSTRAINT "KnowledgeProcedureMaterial_state_check"
  CHECK ("state" IN ('pending','assigned','unassigned','failed'));
