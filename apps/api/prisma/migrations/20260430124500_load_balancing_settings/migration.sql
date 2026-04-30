-- CreateTable
CREATE TABLE "ProductionScheduleResourceCapacityBase" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(120) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "baseAvailableMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleResourceCapacityBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleResourceMonthlyCapacity" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(120) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "yearMonth" VARCHAR(7) NOT NULL,
    "availableMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleResourceMonthlyCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleLoadBalanceClass" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(120) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "classCode" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleLoadBalanceClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleLoadBalanceTransferRule" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(120) NOT NULL,
    "fromClassCode" VARCHAR(80) NOT NULL,
    "toClassCode" VARCHAR(80) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "efficiencyRatio" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleLoadBalanceTransferRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PSResourceCapacityBase_unique_site_rc" ON "ProductionScheduleResourceCapacityBase"("csvDashboardId", "siteKey", "resourceCd");

-- CreateIndex
CREATE INDEX "PSResourceCapacityBase_idx_site" ON "ProductionScheduleResourceCapacityBase"("csvDashboardId", "siteKey");

-- CreateIndex
CREATE UNIQUE INDEX "PSResourceMonthlyCapacity_unique" ON "ProductionScheduleResourceMonthlyCapacity"("csvDashboardId", "siteKey", "resourceCd", "yearMonth");

-- CreateIndex
CREATE INDEX "PSResourceMonthlyCapacity_idx_month" ON "ProductionScheduleResourceMonthlyCapacity"("csvDashboardId", "siteKey", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "PSLoadBalanceClass_unique_rc" ON "ProductionScheduleLoadBalanceClass"("csvDashboardId", "siteKey", "resourceCd");

-- CreateIndex
CREATE INDEX "PSLoadBalanceClass_idx_class" ON "ProductionScheduleLoadBalanceClass"("csvDashboardId", "siteKey", "classCode");

-- CreateIndex
CREATE UNIQUE INDEX "PSLBTransferRule_unique_pri" ON "ProductionScheduleLoadBalanceTransferRule"("csvDashboardId", "siteKey", "fromClassCode", "toClassCode", "priority");

-- CreateIndex
CREATE INDEX "PSLBTransferRule_idx_from" ON "ProductionScheduleLoadBalanceTransferRule"("csvDashboardId", "siteKey", "fromClassCode");
