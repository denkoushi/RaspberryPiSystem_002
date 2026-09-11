ALTER TABLE "ProductionScheduleGrindingPlanningBoardOverride"
  ADD COLUMN "specialDueKind" VARCHAR(20),
  ADD COLUMN "specialDueExpiresAt" TIMESTAMP(3);
