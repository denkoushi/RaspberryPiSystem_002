-- Persist the small set of strong process-change residual evidence keys built from
-- raw FKOJUNST_Status rows during mail sync, so leaderboard reads do not need to
-- scan the full raw mail dashboard on cold display.
CREATE TABLE "ProductionScheduleProcessChangeResidualSnapshot" (
  "sourceCsvDashboardId" TEXT NOT NULL,
  "rawMailRowsRevision" TEXT NOT NULL,
  "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductionScheduleProcessChangeResidualSnapshot_pkey" PRIMARY KEY ("sourceCsvDashboardId")
);

CREATE TABLE "ProductionScheduleProcessChangeResidualEvidence" (
  "id" TEXT NOT NULL,
  "sourceCsvDashboardId" TEXT NOT NULL,
  "productNo" VARCHAR(32) NOT NULL,
  "fkojun" VARCHAR(20) NOT NULL,
  "resourceCd" VARCHAR(40) NOT NULL,
  "currentStatusCode" VARCHAR(1) NOT NULL,
  "currentSourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "completedOtherResourceCd" VARCHAR(40) NOT NULL,
  "completedOtherStatusCode" VARCHAR(1) NOT NULL,
  "completedOtherSourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductionScheduleProcessChangeResidualEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PSProcChangeResidualSnapshot_idx_revision"
  ON "ProductionScheduleProcessChangeResidualSnapshot" ("rawMailRowsRevision");

CREATE UNIQUE INDEX "PSProcChangeResidualEvidence_unique_key"
  ON "ProductionScheduleProcessChangeResidualEvidence" (
    "sourceCsvDashboardId",
    "productNo",
    "fkojun",
    "resourceCd"
  );

CREATE INDEX "PSProcChangeResidualEvidence_idx_source"
  ON "ProductionScheduleProcessChangeResidualEvidence" ("sourceCsvDashboardId");

ALTER TABLE "ProductionScheduleProcessChangeResidualEvidence"
  ADD CONSTRAINT "ProductionScheduleProcessChangeResidualEvidence_sourceCsvDashboardId_fkey"
  FOREIGN KEY ("sourceCsvDashboardId")
  REFERENCES "ProductionScheduleProcessChangeResidualSnapshot"("sourceCsvDashboardId")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
