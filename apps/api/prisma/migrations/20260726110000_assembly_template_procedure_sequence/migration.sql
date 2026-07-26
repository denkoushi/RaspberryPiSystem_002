-- Expand-only: version-owned assembly procedure sequence.
-- Existing templates are intentionally not backfilled and continue through the
-- legacy machine-order/primary-document compatibility resolver.
CREATE TABLE "AssemblyTemplateProcedureItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kioskDocumentId" TEXT,
    "assemblyProcedureDocumentId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyTemplateProcedureItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyTemplateProcedureItem_unique_template_sort"
      UNIQUE ("templateId", "sortOrder"),
    CONSTRAINT "AssemblyTemplateProcedureItem_exactly_one_document_check"
      CHECK (num_nonnulls("kioskDocumentId", "assemblyProcedureDocumentId") = 1),
    CONSTRAINT "AssemblyTemplateProcedureItem_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "AssemblyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssemblyTemplateProcedureItem_kioskDocumentId_fkey"
      FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyTemplateProcedureItem_assemblyProcedureDocumentId_fkey"
      FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AssemblyTemplateProcedureItem_idx_kiosk_document"
  ON "AssemblyTemplateProcedureItem"("kioskDocumentId");

CREATE INDEX "AssemblyTemplateProcedureItem_idx_assembly_document"
  ON "AssemblyTemplateProcedureItem"("assemblyProcedureDocumentId");
