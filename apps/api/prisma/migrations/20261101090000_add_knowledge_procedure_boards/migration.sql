CREATE TABLE "KnowledgeProcedureBoard" (
  "id" TEXT PRIMARY KEY,
  "procedureId" TEXT NOT NULL UNIQUE REFERENCES "KnowledgeProcedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "layout" JSONB NOT NULL,
  "decisions" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "materialFingerprint" TEXT NOT NULL,
  "lastRequestedClientDeviceId" TEXT NOT NULL,
  "trialStartedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "KnowledgeProcedureBoardEvent" (
  "id" TEXT PRIMARY KEY,
  "boardId" TEXT NOT NULL REFERENCES "KnowledgeProcedureBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "boardVersion" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "dedupeKey" TEXT UNIQUE,
  "clientDeviceId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "layoutHash" TEXT,
  "payload" JSONB NOT NULL
);
CREATE INDEX "KnowledgeProcedureBoardEvent_boardId_occurredAt_idx" ON "KnowledgeProcedureBoardEvent"("boardId", "occurredAt");
CREATE INDEX "KnowledgeProcedureBoardEvent_boardId_boardVersion_idx" ON "KnowledgeProcedureBoardEvent"("boardId", "boardVersion");
