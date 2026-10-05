-- Expand-only: document editing reservations are a new sidecar table.
CREATE TABLE "AssemblyProcedureDocumentEditLease" (
    "documentId" TEXT NOT NULL,
    "holderKey" TEXT NOT NULL,
    "holderToken" TEXT NOT NULL,
    "holderLabel" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssemblyProcedureDocumentEditLease_pkey" PRIMARY KEY ("documentId"),
    CONSTRAINT "AssemblyProcedureDocumentEditLease_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
