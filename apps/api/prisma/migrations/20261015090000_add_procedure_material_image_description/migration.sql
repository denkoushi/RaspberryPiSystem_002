-- Additive image-description cache and retry/claim state.
ALTER TABLE "ProcedureMaterial"
    ADD COLUMN "imageDescription" TEXT,
    ADD COLUMN "imageDescribedAt" TIMESTAMP(3),
    ADD COLUMN "imageDescribeAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "imageDescribeNextAttemptAt" TIMESTAMP(3);
