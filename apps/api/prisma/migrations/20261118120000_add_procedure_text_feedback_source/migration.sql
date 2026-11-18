CREATE TYPE "AssemblyProcedureTextFeedbackSource" AS ENUM ('LAYOUT', 'DICTATION');

ALTER TABLE "AssemblyProcedureTextFeedback"
ADD COLUMN "source" "AssemblyProcedureTextFeedbackSource" NOT NULL DEFAULT 'LAYOUT',
ADD COLUMN "mode" TEXT,
ADD COLUMN "spokenText" TEXT;

CREATE INDEX "AssemblyProcedureTextFeedback_site_source_outcome_resolvedA_idx"
ON "AssemblyProcedureTextFeedback"("site", "source", "outcome", "resolvedAt");

ALTER TABLE "AssemblyProcedureLearningSnapshot"
ADD COLUMN "dictationKept" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dictationEdited" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dictationReverted" INTEGER NOT NULL DEFAULT 0;
