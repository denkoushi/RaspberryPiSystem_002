CREATE TABLE "AssemblyProcedureDocumentFeedback" (
    "id" TEXT NOT NULL,
    "revisionRootId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "questions" JSONB NOT NULL,
    "missing" JSONB NOT NULL,
    "unclear" JSONB NOT NULL,
    "ideas" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssemblyProcedureDocumentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssemblyProcedureDocumentFeedback_document_source_key"
    ON "AssemblyProcedureDocumentFeedback"("documentId", "sourceUpdatedAt");
CREATE INDEX "AssemblyProcedureDocumentFeedback_root_source_idx"
    ON "AssemblyProcedureDocumentFeedback"("revisionRootId", "sourceUpdatedAt", "revisionNumber");

ALTER TABLE "AssemblyProcedureDocumentFeedback"
    ADD CONSTRAINT "AssemblyProcedureDocumentFeedback_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
