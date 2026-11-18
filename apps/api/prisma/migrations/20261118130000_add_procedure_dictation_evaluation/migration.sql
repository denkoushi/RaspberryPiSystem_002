ALTER TABLE "AssemblyProcedureLearningSnapshot"
  ADD COLUMN "dictationEvalCases" INTEGER,
  ADD COLUMN "dictationBaselineScore" DOUBLE PRECISION,
  ADD COLUMN "dictationCandidateScore" DOUBLE PRECISION,
  ADD COLUMN "dictationBaselineNumberMisses" INTEGER,
  ADD COLUMN "dictationCandidateNumberMisses" INTEGER,
  ADD COLUMN "dictationLearningAdopted" BOOLEAN,
  ADD COLUMN "dictationLearning" JSONB;
