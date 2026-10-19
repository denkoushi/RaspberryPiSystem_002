CREATE TYPE "AssemblyProcedureCaptionFeedbackOutcome" AS ENUM ('PROPOSED', 'KEPT', 'EDITED', 'DELETED');

CREATE TABLE "AssemblyProcedureCaptionFeedback" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageIndex" INTEGER NOT NULL,
  "elementId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "documentName" TEXT NOT NULL,
  "contextText" TEXT,
  "aiText" TEXT NOT NULL,
  "finalText" TEXT,
  "outcome" "AssemblyProcedureCaptionFeedbackOutcome" NOT NULL DEFAULT 'PROPOSED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AssemblyProcedureCaptionFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssemblyProcedureCaptionFeedback_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AssemblyProcedureAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssemblyProcedureCaptionFeedback_documentId_elementId_key" ON "AssemblyProcedureCaptionFeedback"("documentId", "elementId");
CREATE INDEX "AssemblyProcedureCaptionFeedback_assetId_idx" ON "AssemblyProcedureCaptionFeedback"("assetId");
