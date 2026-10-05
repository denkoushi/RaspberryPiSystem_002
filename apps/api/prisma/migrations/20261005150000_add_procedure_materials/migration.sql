-- Expand-only: new material storage; existing document rows are untouched.
CREATE TYPE "ProcedureMaterialKind" AS ENUM ('TEXT', 'PHOTO');
CREATE TABLE "ProcedureMaterial" (
    "id" TEXT NOT NULL,
    "kind" "ProcedureMaterialKind" NOT NULL,
    "text" TEXT,
    "storageKey" TEXT,
    "sha256" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "originalFileName" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "subjectHint" TEXT,
    "fromEmail" TEXT,
    "gmailMessageId" TEXT NOT NULL,
    "gmailDedupeKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "documentId" TEXT,
    "placedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcedureMaterial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProcedureMaterial_documentId_fkey" FOREIGN KEY ("documentId")
        REFERENCES "AssemblyProcedureDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProcedureMaterial_gmailDedupeKey_key" ON "ProcedureMaterial"("gmailDedupeKey");
CREATE INDEX "ProcedureMaterial_documentId_discardedAt_receivedAt_idx" ON "ProcedureMaterial"("documentId", "discardedAt", "receivedAt");
CREATE INDEX "ProcedureMaterial_gmailMessageId_idx" ON "ProcedureMaterial"("gmailMessageId");
