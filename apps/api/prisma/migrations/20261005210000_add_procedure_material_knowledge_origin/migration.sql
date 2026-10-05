CREATE TYPE "ProcedureMaterialOrigin" AS ENUM ('GMAIL', 'KNOWLEDGE');

ALTER TABLE "ProcedureMaterial"
  ADD COLUMN "origin" "ProcedureMaterialOrigin" NOT NULL DEFAULT 'GMAIL',
  ADD COLUMN "knowledgeRef" JSONB,
  ALTER COLUMN "gmailMessageId" DROP NOT NULL;
