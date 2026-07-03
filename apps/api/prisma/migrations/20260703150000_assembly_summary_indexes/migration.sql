CREATE INDEX "AssemblyProcedureDocument_idx_active_updated"
ON "AssemblyProcedureDocument"("isActive", "updatedAt");

CREATE INDEX "AssemblyTemplate_idx_active_updated"
ON "AssemblyTemplate"("isActive", "updatedAt");

CREATE INDEX "AssemblyTemplate_idx_document_active_updated"
ON "AssemblyTemplate"("procedureDocumentId", "isActive", "updatedAt");
