ALTER TABLE "DueManagementOperatorDecisionEvent"
ADD COLUMN "reasonCode" VARCHAR(40);

CREATE TYPE "DueManagementTuningHistoryStatus" AS ENUM (
  'CANDIDATE',
  'APPLIED',
  'REJECTED',
  'ROLLED_BACK'
);

CREATE TABLE "ProductionScheduleDueManagementTuningStableSnapshot" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "params" JSONB NOT NULL,
  "previousParams" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "previousVersion" INTEGER,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionScheduleDueManagementTuningStableSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionScheduleDueManagementTuningHistory" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "status" "DueManagementTuningHistoryStatus" NOT NULL,
  "label" VARCHAR(60) NOT NULL,
  "candidateParams" JSONB NOT NULL,
  "baseParams" JSONB NOT NULL,
  "evaluation" JSONB,
  "guardReason" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScheduleDueManagementTuningHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionScheduleDueManagementTuningFailureHistory" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "reason" VARCHAR(200) NOT NULL,
  "candidateParams" JSONB,
  "previousStableParams" JSONB,
  "metrics" JSONB,
  "failedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScheduleDueManagementTuningFailureHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleDueManagementTuningStableSnapshot_csvDashboardId_location_key"
ON "ProductionScheduleDueManagementTuningStableSnapshot"("csvDashboardId", "location");

CREATE INDEX "PSDMTuningStable_idx_loc"
ON "ProductionScheduleDueManagementTuningStableSnapshot"("csvDashboardId", "location", "activatedAt");

CREATE INDEX "ProductionScheduleDueManagementTuningHistory_idx_location_time"
ON "ProductionScheduleDueManagementTuningHistory"("csvDashboardId", "location", "createdAt");

CREATE INDEX "ProductionScheduleDueManagementTuningHistory_idx_status"
ON "ProductionScheduleDueManagementTuningHistory"("csvDashboardId", "location", "status");

CREATE INDEX "PSDMTuningFailure_idx_time"
ON "ProductionScheduleDueManagementTuningFailureHistory"("csvDashboardId", "location", "failedAt");
