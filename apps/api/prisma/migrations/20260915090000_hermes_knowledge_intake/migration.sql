CREATE TABLE "KnowledgeIntake" (
  "id" TEXT PRIMARY KEY,
  "sequence" BIGSERIAL NOT NULL UNIQUE,
  "ownerKey" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "sources" JSONB,
  "organized" JSONB,
  "state" TEXT NOT NULL DEFAULT 'receiving',
  "action" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "result" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeIntake_state_check" CHECK ("state" IN ('receiving','pending','working','choice','ready','answered','delegated','failed','superseded')),
  CONSTRAINT "KnowledgeIntake_action_check" CHECK ("action" IS NULL OR "action" IN ('save','ask','report','delegate','clarify'))
);
CREATE INDEX "KnowledgeIntake_state_retryAt_createdAt_idx" ON "KnowledgeIntake"("state","retryAt","createdAt");
CREATE INDEX "KnowledgeIntake_ownerKey_conversationId_createdAt_idx" ON "KnowledgeIntake"("ownerKey","conversationId","createdAt");
CREATE TABLE "KnowledgeTopic" (
  "id" TEXT PRIMARY KEY,
  "revision" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3)
);
