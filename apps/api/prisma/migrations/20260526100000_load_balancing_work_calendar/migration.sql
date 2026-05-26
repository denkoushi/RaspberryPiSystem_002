-- CreateTable
CREATE TABLE "ProductionScheduleResourceWorkCalendar" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "siteKey" VARCHAR(120) NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "workCalendarMode" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleResourceWorkCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PSResourceWorkCalendar_idx_site" ON "ProductionScheduleResourceWorkCalendar"("csvDashboardId", "siteKey");

-- CreateIndex
CREATE UNIQUE INDEX "PSResourceWorkCalendar_unique_rc" ON "ProductionScheduleResourceWorkCalendar"("csvDashboardId", "siteKey", "resourceCd");
