-- Expand-only: template-version-owned virtual procedure steps.
-- Existing templates and marker rows are intentionally not backfilled.
CREATE TYPE "AssemblyProcedureStepViewMode" AS ENUM ('FULL_PAGE', 'CROP');
CREATE TYPE "AssemblyProcedureStepEmphasis" AS ENUM ('NORMAL', 'IMPORTANT', 'CAUTION');

CREATE TABLE "AssemblyTemplateProcedureStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kioskDocumentId" TEXT,
    "assemblyProcedureDocumentId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "viewMode" "AssemblyProcedureStepViewMode" NOT NULL,
    "cropXRatio" DECIMAL(10,8),
    "cropYRatio" DECIMAL(10,8),
    "cropWidthRatio" DECIMAL(10,8),
    "cropHeightRatio" DECIMAL(10,8),
    "title" TEXT,
    "instructionText" TEXT,
    "emphasis" "AssemblyProcedureStepEmphasis" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyTemplateProcedureStep_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyTemplateProcedureStep_unique_template_sort"
      UNIQUE ("templateId", "sortOrder"),
    CONSTRAINT "AssemblyTemplateProcedureStep_exactly_one_document_check"
      CHECK (num_nonnulls("kioskDocumentId", "assemblyProcedureDocumentId") = 1),
    CONSTRAINT "AssemblyTemplateProcedureStep_page_index_check"
      CHECK ("pageIndex" >= 0),
    CONSTRAINT "AssemblyTemplateProcedureStep_title_length_check"
      CHECK ("title" IS NULL OR char_length("title") <= 120),
    CONSTRAINT "AssemblyTemplateProcedureStep_instruction_length_check"
      CHECK ("instructionText" IS NULL OR char_length("instructionText") <= 1000),
    CONSTRAINT "AssemblyTemplateProcedureStep_crop_check"
      CHECK (
        (
          "viewMode" = 'FULL_PAGE'
          AND num_nonnulls("cropXRatio", "cropYRatio", "cropWidthRatio", "cropHeightRatio") = 0
        )
        OR
        (
          "viewMode" = 'CROP'
          AND num_nonnulls("cropXRatio", "cropYRatio", "cropWidthRatio", "cropHeightRatio") = 4
          AND "cropXRatio" >= 0
          AND "cropYRatio" >= 0
          AND "cropWidthRatio" >= 0.02
          AND "cropHeightRatio" >= 0.02
          AND "cropXRatio" + "cropWidthRatio" <= 1
          AND "cropYRatio" + "cropHeightRatio" <= 1
        )
      ),
    CONSTRAINT "AssemblyTemplateProcedureStep_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "AssemblyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssemblyTemplateProcedureStep_kioskDocumentId_fkey"
      FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyTemplateProcedureStep_assemblyProcedureDocumentId_fkey"
      FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AssemblyTemplateProcedureStep_idx_kiosk_document"
  ON "AssemblyTemplateProcedureStep"("kioskDocumentId");

CREATE INDEX "AssemblyTemplateProcedureStep_idx_assembly_document"
  ON "AssemblyTemplateProcedureStep"("assemblyProcedureDocumentId");
