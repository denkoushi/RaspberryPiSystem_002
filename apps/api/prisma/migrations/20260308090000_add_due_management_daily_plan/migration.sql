-- CreateTable
CREATE TABLE "ProductionScheduleDailyPlan" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleDailyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleDailyPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fseiban" VARCHAR(20) NOT NULL,
    "priorityOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleDailyPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleDailyPlan_unique_date" ON "ProductionScheduleDailyPlan"("csvDashboardId", "location", "planDate");

-- CreateIndex
CREATE INDEX "ProductionScheduleDailyPlan_idx_location" ON "ProductionScheduleDailyPlan"("csvDashboardId", "location", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleDailyPlanItem_unique_fseiban" ON "ProductionScheduleDailyPlanItem"("planId", "fseiban");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleDailyPlanItem_unique_order" ON "ProductionScheduleDailyPlanItem"("planId", "priorityOrder");

-- CreateIndex
CREATE INDEX "ProductionScheduleDailyPlanItem_idx_order" ON "ProductionScheduleDailyPlanItem"("planId", "priorityOrder");

-- AddForeignKey
ALTER TABLE "ProductionScheduleDailyPlanItem" ADD CONSTRAINT "ProductionScheduleDailyPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductionScheduleDailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
