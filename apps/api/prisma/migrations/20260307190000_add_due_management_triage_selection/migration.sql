-- 納期管理トリアージ選択（拠点共有）
CREATE TABLE "ProductionScheduleTriageSelection" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "fseiban" VARCHAR(20) NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductionScheduleTriageSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleTriageSelection_unique_item"
  ON "ProductionScheduleTriageSelection"("csvDashboardId", "location", "fseiban");

CREATE INDEX "ProductionScheduleTriageSelection_idx_location"
  ON "ProductionScheduleTriageSelection"("csvDashboardId", "location", "selectedAt");
