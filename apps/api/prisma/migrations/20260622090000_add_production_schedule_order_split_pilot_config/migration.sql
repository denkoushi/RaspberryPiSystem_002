-- Runtime pilot gate for production-schedule order split rollout.
-- The deployment/env flag remains the parent kill switch; this row controls
-- whether the already-deployed feature is available to real kiosk workflows.
CREATE TABLE "ProductionScheduleOrderSplitPilotConfig" (
    "key" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleOrderSplitPilotConfig_pkey" PRIMARY KEY ("key")
);
