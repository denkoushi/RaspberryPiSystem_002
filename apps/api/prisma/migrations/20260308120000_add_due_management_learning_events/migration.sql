-- CreateTable
CREATE TABLE "DueManagementProposalEvent" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "orderedFseibans" TEXT[],
    "candidateCount" INTEGER NOT NULL,
    "selectedFseibans" TEXT[],
    "writePolicy" JSONB,
    "actorClientKey" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueManagementProposalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueManagementOperatorDecisionEvent" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "sourceType" VARCHAR(20) NOT NULL,
    "orderedFseibans" TEXT[],
    "previousOrderedFseibans" TEXT[],
    "proposalOrderedFseibans" TEXT[],
    "reorderDeltaRatio" DOUBLE PRECISION,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueManagementOperatorDecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueManagementOutcomeEvent" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "eventType" VARCHAR(40) NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "fseiban" VARCHAR(20),
    "isCompleted" BOOLEAN NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueManagementOutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DueManagementProposalEvent_idx_location_time" ON "DueManagementProposalEvent"("csvDashboardId", "location", "createdAt");

-- CreateIndex
CREATE INDEX "DueManagementOperatorDecisionEvent_idx_location_time" ON "DueManagementOperatorDecisionEvent"("csvDashboardId", "location", "createdAt");

-- CreateIndex
CREATE INDEX "DueManagementOperatorDecisionEvent_idx_source" ON "DueManagementOperatorDecisionEvent"("csvDashboardId", "location", "sourceType");

-- CreateIndex
CREATE INDEX "DueManagementOutcomeEvent_idx_location_time" ON "DueManagementOutcomeEvent"("csvDashboardId", "location", "createdAt");

-- CreateIndex
CREATE INDEX "DueManagementOutcomeEvent_idx_fseiban" ON "DueManagementOutcomeEvent"("csvDashboardId", "location", "fseiban");

-- CreateIndex
CREATE INDEX "DueManagementOutcomeEvent_idx_event_type" ON "DueManagementOutcomeEvent"("csvDashboardId", "location", "eventType");
