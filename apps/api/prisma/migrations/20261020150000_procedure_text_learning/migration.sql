CREATE TYPE "AssemblyProcedureTextFeedbackOutcome" AS ENUM ('PROPOSED', 'KEPT', 'EDITED', 'REVERTED');

CREATE TABLE "AssemblyProcedureTextFeedback" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageIndex" INTEGER NOT NULL,
  "elementId" TEXT NOT NULL,
  "site" TEXT,
  "documentName" TEXT NOT NULL,
  "originalText" TEXT NOT NULL,
  "aiText" TEXT NOT NULL,
  "finalText" TEXT,
  "outcome" "AssemblyProcedureTextFeedbackOutcome" NOT NULL DEFAULT 'PROPOSED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AssemblyProcedureTextFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyProcedureLearnedTerm" (
  "id" TEXT NOT NULL,
  "site" TEXT NOT NULL,
  "wrongText" TEXT NOT NULL,
  "rightText" TEXT NOT NULL,
  "occurrences" INTEGER NOT NULL,
  "documentCount" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssemblyProcedureLearnedTerm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssemblyProcedureTextFeedback_documentId_elementId_idx" ON "AssemblyProcedureTextFeedback"("documentId", "elementId");
CREATE INDEX "AssemblyProcedureTextFeedback_site_outcome_resolvedAt_idx" ON "AssemblyProcedureTextFeedback"("site", "outcome", "resolvedAt");
CREATE UNIQUE INDEX "AssemblyProcedureLearnedTerm_site_wrongText_key" ON "AssemblyProcedureLearnedTerm"("site", "wrongText");
