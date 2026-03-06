-- 製番単位納期（新規）
CREATE TABLE "ProductionScheduleSeibanDueDate" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "fseiban" VARCHAR(20) NOT NULL,
  "dueDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionScheduleSeibanDueDate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleSeibanDueDate_csvDashboardId_location_fseiban_key"
  ON "ProductionScheduleSeibanDueDate"("csvDashboardId", "location", "fseiban");

CREATE INDEX "ProductionScheduleSeibanDueDate_csvDashboardId_location_dueDate_idx"
  ON "ProductionScheduleSeibanDueDate"("csvDashboardId", "location", "dueDate");

-- 製番内の部品優先順位（新規）
CREATE TABLE "ProductionSchedulePartPriority" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "fseiban" VARCHAR(20) NOT NULL,
  "fhincd" VARCHAR(50) NOT NULL,
  "priorityRank" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionSchedulePartPriority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionSchedulePartPriority_unique_part"
  ON "ProductionSchedulePartPriority"("csvDashboardId", "location", "fseiban", "fhincd");

CREATE UNIQUE INDEX "ProductionSchedulePartPriority_unique_rank"
  ON "ProductionSchedulePartPriority"("csvDashboardId", "location", "fseiban", "priorityRank");

CREATE INDEX "ProductionSchedulePartPriority_csvDashboardId_location_fseiban_idx"
  ON "ProductionSchedulePartPriority"("csvDashboardId", "location", "fseiban");

-- 工程カテゴリ設定（切削除外リスト）
CREATE TABLE "ProductionScheduleResourceCategoryConfig" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "cuttingExcludedResourceCds" TEXT[] DEFAULT ARRAY['10', 'MSZ']::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionScheduleResourceCategoryConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleResourceCategoryConfig_unique_location"
  ON "ProductionScheduleResourceCategoryConfig"("csvDashboardId", "location");

CREATE INDEX "ProductionScheduleResourceCategoryConfig_idx_location"
  ON "ProductionScheduleResourceCategoryConfig"("csvDashboardId", "location");
