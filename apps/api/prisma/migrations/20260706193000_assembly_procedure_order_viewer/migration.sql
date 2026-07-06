-- 組立キオスク: 機種名ごとのPDF要領書閲覧順設定
CREATE TABLE "AssemblyProcedureOrderSet" (
  "id" TEXT NOT NULL,
  "machineName" TEXT NOT NULL,
  "machineNameKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssemblyProcedureOrderSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyProcedureOrderItem" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "kioskDocumentId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssemblyProcedureOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssemblyProcedureOrderSet_machineNameKey_key"
  ON "AssemblyProcedureOrderSet"("machineNameKey");

CREATE INDEX "AssemblyProcedureOrderSet_idx_machine_name"
  ON "AssemblyProcedureOrderSet"("machineName");

CREATE UNIQUE INDEX "AssemblyProcedureOrderItem_unique_set_sort"
  ON "AssemblyProcedureOrderItem"("setId", "sortOrder");

CREATE INDEX "AssemblyProcedureOrderItem_idx_set_sort"
  ON "AssemblyProcedureOrderItem"("setId", "sortOrder");

CREATE INDEX "AssemblyProcedureOrderItem_idx_document"
  ON "AssemblyProcedureOrderItem"("kioskDocumentId");

ALTER TABLE "AssemblyProcedureOrderItem"
  ADD CONSTRAINT "AssemblyProcedureOrderItem_setId_fkey"
  FOREIGN KEY ("setId") REFERENCES "AssemblyProcedureOrderSet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyProcedureOrderItem"
  ADD CONSTRAINT "AssemblyProcedureOrderItem_kioskDocumentId_fkey"
  FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
