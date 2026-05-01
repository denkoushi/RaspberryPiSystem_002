ALTER TABLE "ProductionScheduleOrderSupplement"
  ADD COLUMN "plannedStartDateManuallySet" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "ProductionScheduleOrderSupplement_idx_start_date"
  ON "ProductionScheduleOrderSupplement"("plannedStartDate");

CREATE INDEX "ProductionScheduleOrderSupplement_idx_last_seen"
  ON "ProductionScheduleOrderSupplement"("lastSeenAt");
