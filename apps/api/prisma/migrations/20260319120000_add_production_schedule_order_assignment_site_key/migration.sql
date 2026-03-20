-- AlterTable
ALTER TABLE "ProductionScheduleOrderAssignment" ADD COLUMN "siteKey" TEXT NOT NULL DEFAULT '';

-- Backfill siteKey from location (deviceScopeKey): site segment before " - ", else whole location (legacy site-only rows)
UPDATE "ProductionScheduleOrderAssignment"
SET "siteKey" = CASE
  WHEN POSITION(' - ' IN "location") > 0 THEN
    TRIM(SUBSTRING("location" FROM 1 FOR POSITION(' - ' IN "location") - 1))
  ELSE TRIM("location")
END;

ALTER TABLE "ProductionScheduleOrderAssignment" ALTER COLUMN "siteKey" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "ProductionScheduleOrderAssignment_csvDashboardId_siteKey_idx" ON "ProductionScheduleOrderAssignment"("csvDashboardId", "siteKey");
