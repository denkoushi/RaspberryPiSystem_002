CREATE TABLE "ProcedureManualApproval" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeCodeSnapshot" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "employeeNfcTagUidSnapshot" TEXT NOT NULL,
    "employeePositionSnapshot" TEXT,
    "employeeRankSnapshot" TEXT NOT NULL,
    "comment" TEXT,
    "actorKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcedureManualApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProcedureManualApproval_documentId_createdAt_idx" ON "ProcedureManualApproval"("documentId", "createdAt");
ALTER TABLE "ProcedureManualApproval" ADD CONSTRAINT "ProcedureManualApproval_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
