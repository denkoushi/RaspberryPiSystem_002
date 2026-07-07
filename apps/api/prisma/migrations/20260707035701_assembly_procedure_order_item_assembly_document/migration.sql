-- 組立キオスク閲覧順: 組立手順書(AssemblyProcedureDocument)参照を追加し、PDF要領書参照を任意化
ALTER TABLE "AssemblyProcedureOrderItem"
  ADD COLUMN "assemblyProcedureDocumentId" TEXT,
  ALTER COLUMN "kioskDocumentId" DROP NOT NULL;

CREATE INDEX "AssemblyProcedureOrderItem_idx_assembly_document"
  ON "AssemblyProcedureOrderItem"("assemblyProcedureDocumentId");

ALTER TABLE "AssemblyProcedureOrderItem"
  ADD CONSTRAINT "AssemblyProcedureOrderItem_assemblyProcedureDocumentId_fkey"
  FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
