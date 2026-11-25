BEGIN;

ALTER TABLE "ProductionScheduleExternalCompletion"
  ADD COLUMN "externallyCompletedFromFkojunstResourceSwap" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProductionScheduleFkojunstMailStatus"
  ADD COLUMN "hasUnparseableDate" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ProductionScheduleFkojunstMailStatus"
SET "hasUnparseableDate" = true
WHERE "sourceUpdatedAt" = TIMESTAMP '1970-01-01 00:00:00';

CREATE TABLE "ProductionScheduleFkojunstResourceSwapEvidence" (
  "sourceCsvDashboardId" TEXT NOT NULL,
  "productNo" TEXT NOT NULL,
  "fkojun" TEXT NOT NULL,
  "resourceCd" TEXT NOT NULL,
  "statusCode" VARCHAR(1) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  CONSTRAINT "PSFkojunstResourceSwapEvidence_pkey"
    PRIMARY KEY ("sourceCsvDashboardId", "productNo", "fkojun", "resourceCd")
);

CREATE INDEX "PSFkojunstResourceSwapEvidence_idx_process"
  ON "ProductionScheduleFkojunstResourceSwapEvidence" ("sourceCsvDashboardId", "productNo", "fkojun");

COMMIT;
