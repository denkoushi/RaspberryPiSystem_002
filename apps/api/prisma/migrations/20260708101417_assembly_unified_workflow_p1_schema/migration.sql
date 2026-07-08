-- Assembly unified workflow Phase 1: publish gate, multi-page procedure documents, page-level markers, check items.

-- CreateEnum
CREATE TYPE "AssemblyProcedureDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "AssemblyProcedureDocument"
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "status" "AssemblyProcedureDocumentStatus" NOT NULL DEFAULT 'DRAFT';

-- Backfill: existing production documents remain usable without an explicit publish step.
UPDATE "AssemblyProcedureDocument"
SET
  "status" = 'PUBLISHED',
  "publishedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "AssemblyProcedureDocumentPage" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageIndex" INTEGER NOT NULL,
  "imageRelativePath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssemblyProcedureDocumentPage_pkey" PRIMARY KEY ("id")
);

-- Backfill: one page row per existing document (pageIndex=0 mirrors imageRelativePath).
INSERT INTO "AssemblyProcedureDocumentPage" ("id", "documentId", "pageIndex", "imageRelativePath", "createdAt")
SELECT
  gen_random_uuid()::text,
  d."id",
  0,
  d."imageRelativePath",
  COALESCE(d."createdAt", CURRENT_TIMESTAMP)
FROM "AssemblyProcedureDocument" AS d;

-- AlterTable
ALTER TABLE "AssemblyTemplateBolt"
  ADD COLUMN "assemblyProcedureDocumentId" TEXT,
  ADD COLUMN "kioskDocumentId" TEXT,
  ADD COLUMN "pageIndex" INTEGER;

-- CreateTable
CREATE TABLE "AssemblyTemplateCheckItem" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "markerNo" INTEGER NOT NULL,
  "label" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "xRatio" DOUBLE PRECISION NOT NULL,
  "yRatio" DOUBLE PRECISION NOT NULL,
  "kioskDocumentId" TEXT,
  "assemblyProcedureDocumentId" TEXT,
  "pageIndex" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssemblyTemplateCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyCheckRecord" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "checkItemId" TEXT NOT NULL,
  "checked" BOOLEAN NOT NULL,
  "checkedByOperatorName" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssemblyCheckRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssemblyProcedureDocumentPage_idx_document"
  ON "AssemblyProcedureDocumentPage"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyProcedureDocumentPage_unique_document_page"
  ON "AssemblyProcedureDocumentPage"("documentId", "pageIndex");

-- CreateIndex
CREATE INDEX "AssemblyProcedureDocument_idx_status_active"
  ON "AssemblyProcedureDocument"("status", "isActive");

-- CreateIndex
CREATE INDEX "AssemblyTemplateBolt_idx_kiosk_document"
  ON "AssemblyTemplateBolt"("kioskDocumentId");

-- CreateIndex
CREATE INDEX "AssemblyTemplateBolt_idx_assembly_document"
  ON "AssemblyTemplateBolt"("assemblyProcedureDocumentId");

-- CreateIndex
CREATE INDEX "AssemblyTemplateCheckItem_idx_template"
  ON "AssemblyTemplateCheckItem"("templateId");

-- CreateIndex
CREATE INDEX "AssemblyTemplateCheckItem_idx_kiosk_document"
  ON "AssemblyTemplateCheckItem"("kioskDocumentId");

-- CreateIndex
CREATE INDEX "AssemblyTemplateCheckItem_idx_assembly_document"
  ON "AssemblyTemplateCheckItem"("assemblyProcedureDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyTemplateCheckItem_unique_template_sort"
  ON "AssemblyTemplateCheckItem"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyTemplateCheckItem_unique_template_marker"
  ON "AssemblyTemplateCheckItem"("templateId", "markerNo");

-- CreateIndex
CREATE INDEX "AssemblyCheckRecord_idx_session"
  ON "AssemblyCheckRecord"("sessionId");

-- CreateIndex
CREATE INDEX "AssemblyCheckRecord_idx_check_item"
  ON "AssemblyCheckRecord"("checkItemId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckRecord_unique_session_check_item"
  ON "AssemblyCheckRecord"("sessionId", "checkItemId");

-- AddForeignKey
ALTER TABLE "AssemblyProcedureDocumentPage"
  ADD CONSTRAINT "AssemblyProcedureDocumentPage_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "AssemblyProcedureDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyTemplateBolt"
  ADD CONSTRAINT "AssemblyTemplateBolt_kioskDocumentId_fkey"
  FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyTemplateBolt"
  ADD CONSTRAINT "AssemblyTemplateBolt_assemblyProcedureDocumentId_fkey"
  FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyTemplateCheckItem"
  ADD CONSTRAINT "AssemblyTemplateCheckItem_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "AssemblyTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyTemplateCheckItem"
  ADD CONSTRAINT "AssemblyTemplateCheckItem_kioskDocumentId_fkey"
  FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyTemplateCheckItem"
  ADD CONSTRAINT "AssemblyTemplateCheckItem_assemblyProcedureDocumentId_fkey"
  FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyCheckRecord"
  ADD CONSTRAINT "AssemblyCheckRecord_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyCheckRecord"
  ADD CONSTRAINT "AssemblyCheckRecord_checkItemId_fkey"
  FOREIGN KEY ("checkItemId") REFERENCES "AssemblyTemplateCheckItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
