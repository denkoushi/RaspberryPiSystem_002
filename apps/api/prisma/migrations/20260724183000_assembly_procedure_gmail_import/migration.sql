CREATE TYPE "AssemblyProcedureDocumentSource" AS ENUM ('MANUAL', 'GMAIL');

CREATE TABLE "AssemblyProcedureDocumentSourceRecord" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceType" "AssemblyProcedureDocumentSource" NOT NULL DEFAULT 'MANUAL',
    "gmailMessageId" TEXT,
    "sourceAttachmentName" TEXT,
    "gmailInternalDateMs" BIGINT,
    "gmailDedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyProcedureDocumentSourceRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyProcedureDocumentSourceRecord_documentId_fkey"
        FOREIGN KEY ("documentId")
        REFERENCES "AssemblyProcedureDocument"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssemblyProcedureDocumentSourceRecord_documentId_key"
ON "AssemblyProcedureDocumentSourceRecord"("documentId");

CREATE UNIQUE INDEX "AssemblyProcedureDocumentSourceRecord_gmailDedupeKey_key"
ON "AssemblyProcedureDocumentSourceRecord"("gmailDedupeKey");

CREATE INDEX "AssemblyProcedureDocumentSourceRecord_gmailMessageId_idx"
ON "AssemblyProcedureDocumentSourceRecord"("gmailMessageId");
