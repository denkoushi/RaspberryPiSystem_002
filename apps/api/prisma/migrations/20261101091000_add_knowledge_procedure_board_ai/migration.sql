CREATE TABLE "KnowledgeProcedureBoardAi" (
  "id" TEXT PRIMARY KEY,
  "boardId" TEXT NOT NULL REFERENCES "KnowledgeProcedureBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "boardVersion" INTEGER NOT NULL CHECK ("boardVersion" >= 1),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('placement', 'format')),
  "requestKey" TEXT NOT NULL,
  "requestedByClientDeviceId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'running', 'ready', 'deferred', 'failed', 'stale', 'accepted', 'reverted')),
  "input" JSONB NOT NULL,
  "result" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("boardId", "kind", "requestKey")
);
CREATE INDEX "KnowledgeProcedureBoardAi_state_retryAt_createdAt_idx" ON "KnowledgeProcedureBoardAi"("state", "retryAt", "createdAt");
CREATE INDEX "KnowledgeProcedureBoardAi_boardId_boardVersion_kind_idx" ON "KnowledgeProcedureBoardAi"("boardId", "boardVersion", "kind");
