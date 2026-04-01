CREATE TABLE "ProductionScheduleOrderSupplement" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "csvDashboardRowId" TEXT NOT NULL,
    "sourceCsvDashboardId" TEXT NOT NULL,
    "productNo" VARCHAR(20) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "processOrder" VARCHAR(20) NOT NULL,
    "plannedQuantity" INTEGER,
    "plannedStartDate" DATE,
    "plannedEndDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScheduleOrderSupplement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleOrderSupplement_unique_row"
    ON "ProductionScheduleOrderSupplement"("csvDashboardRowId");

CREATE UNIQUE INDEX "ProductionScheduleOrderSupplement_unique_source_key"
    ON "ProductionScheduleOrderSupplement"("csvDashboardId", "sourceCsvDashboardId", "productNo", "resourceCd", "processOrder");

CREATE INDEX "ProductionScheduleOrderSupplement_idx_dashboard"
    ON "ProductionScheduleOrderSupplement"("csvDashboardId");

CREATE INDEX "ProductionScheduleOrderSupplement_idx_source_dashboard"
    ON "ProductionScheduleOrderSupplement"("sourceCsvDashboardId");

ALTER TABLE "ProductionScheduleOrderSupplement"
    ADD CONSTRAINT "ProductionScheduleOrderSupplement_csvDashboardRowId_fkey"
    FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
