-- CreateTable
CREATE TABLE "ProductionScheduleOrderSplit" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "parentCsvDashboardRowId" TEXT NOT NULL,
    "splitNo" INTEGER NOT NULL,
    "splitQuantity" INTEGER NOT NULL,
    "dueDate" DATE,
    "plannedStartDate" DATE,
    "plannedEndDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleOrderSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleOrderSplitAssignment" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "splitId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleOrderSplitAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleOrderSplitAuditLog" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "actorClientKey" TEXT,
    "actorLocation" TEXT,
    "targetLocation" TEXT,
    "siteKey" TEXT,
    "actionType" TEXT NOT NULL,
    "requestId" TEXT,
    "parentCsvDashboardRowId" TEXT NOT NULL,
    "splitId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionScheduleOrderSplitAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PSOrderSplit_idx_dashboard" ON "ProductionScheduleOrderSplit"("csvDashboardId");

-- CreateIndex
CREATE INDEX "PSOrderSplit_idx_parent_row" ON "ProductionScheduleOrderSplit"("parentCsvDashboardRowId");

-- CreateIndex
CREATE UNIQUE INDEX "PSOrderSplit_unique_parent_split_no" ON "ProductionScheduleOrderSplit"("parentCsvDashboardRowId", "splitNo");

-- CreateIndex
CREATE INDEX "PSOrderSplitAssign_idx_loc_resource" ON "ProductionScheduleOrderSplitAssignment"("csvDashboardId", "location", "resourceCd");

-- CreateIndex
CREATE INDEX "PSOrderSplitAssign_idx_site" ON "ProductionScheduleOrderSplitAssignment"("csvDashboardId", "siteKey");

-- CreateIndex
CREATE UNIQUE INDEX "PSOrderSplitAssign_unique_order_slot" ON "ProductionScheduleOrderSplitAssignment"("csvDashboardId", "location", "resourceCd", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PSOrderSplitAssign_unique_split_location" ON "ProductionScheduleOrderSplitAssignment"("splitId", "location");

-- CreateIndex
CREATE INDEX "PSOrderSplitAudit_idx_parent" ON "ProductionScheduleOrderSplitAuditLog"("parentCsvDashboardRowId");

-- CreateIndex
CREATE INDEX "PSOrderSplitAudit_idx_split" ON "ProductionScheduleOrderSplitAuditLog"("splitId");

-- CreateIndex
CREATE INDEX "PSOrderSplitAudit_idx_created" ON "ProductionScheduleOrderSplitAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ProductionScheduleOrderSplit" ADD CONSTRAINT "ProductionScheduleOrderSplit_parentCsvDashboardRowId_fkey" FOREIGN KEY ("parentCsvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionScheduleOrderSplitAssignment" ADD CONSTRAINT "ProductionScheduleOrderSplitAssignment_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "ProductionScheduleOrderSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
