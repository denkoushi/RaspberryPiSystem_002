CREATE TYPE "AssemblyProcedureDocumentSource" AS ENUM ('MANUAL', 'GMAIL');

ALTER TABLE "AssemblyProcedureDocument"
ADD COLUMN "sourceType" "AssemblyProcedureDocumentSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "gmailMessageId" TEXT,
ADD COLUMN "sourceAttachmentName" TEXT,
ADD COLUMN "gmailInternalDateMs" BIGINT,
ADD COLUMN "gmailDedupeKey" TEXT;

CREATE UNIQUE INDEX "AssemblyProcedureDocument_gmailDedupeKey_key"
ON "AssemblyProcedureDocument"("gmailDedupeKey");
