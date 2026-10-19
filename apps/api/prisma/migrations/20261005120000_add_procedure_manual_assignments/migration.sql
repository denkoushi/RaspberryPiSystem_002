-- Expand-only: new tables and constraints only; existing rows are untouched.
CREATE TABLE "ProcedureManualProcess" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "resourceCd" TEXT,
    CONSTRAINT "ProcedureManualProcess_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProcedureManualProcess_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProcedureManualProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProcedureManualProcess_parentId_sortOrder_idx" ON "ProcedureManualProcess"("parentId", "sortOrder");

CREATE TABLE "ProcedureManualAssignment" (
    "id" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "modelCodeKey" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "kioskDocumentId" TEXT,
    "assemblyProcedureDocumentId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcedureManualAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProcedureManualAssignment_document_choice_check" CHECK (("kioskDocumentId" IS NOT NULL) <> ("assemblyProcedureDocumentId" IS NOT NULL)),
    CONSTRAINT "ProcedureManualAssignment_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ProcedureManualProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcedureManualAssignment_kioskDocumentId_fkey" FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcedureManualAssignment_assemblyProcedureDocumentId_fkey" FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProcedureManualAssignment_unique_order" ON "ProcedureManualAssignment"("modelCodeKey", "processId", "sortOrder");
CREATE INDEX "ProcedureManualAssignment_kioskDocumentId_idx" ON "ProcedureManualAssignment"("kioskDocumentId");
CREATE INDEX "ProcedureManualAssignment_assemblyProcedureDocumentId_idx" ON "ProcedureManualAssignment"("assemblyProcedureDocumentId");

INSERT INTO "ProcedureManualProcess" ("id", "parentId", "name", "sortOrder") VALUES
    ('procedure-manual-assembly', NULL, '組立工程', 0)
ON CONFLICT DO NOTHING;
INSERT INTO "ProcedureManualProcess" ("id", "parentId", "name", "sortOrder") VALUES
    ('procedure-manual-assembly-work', 'procedure-manual-assembly', '組立工程', 0),
    ('procedure-manual-inspection', 'procedure-manual-assembly', '検査工程', 1)
ON CONFLICT DO NOTHING;
