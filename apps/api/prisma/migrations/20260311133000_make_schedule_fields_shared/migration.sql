-- 納期・備考・表面処理をロケーション非依存の共有データへ統合する
-- 競合解決は updatedAt DESC（同値時は createdAt DESC, id DESC）で Last-Write-Wins

-- 1) ProductionScheduleRowNote を row 単位で統合
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "csvDashboardRowId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "ProductionScheduleRowNote"
)
DELETE FROM "ProductionScheduleRowNote"
WHERE "id" IN (
  SELECT "id"
  FROM ranked
  WHERE rn > 1
);

ALTER TABLE "ProductionScheduleRowNote"
  DROP CONSTRAINT IF EXISTS "ProductionScheduleRowNote_csvDashboardRowId_location_key";
DROP INDEX IF EXISTS "ProductionScheduleRowNote_csvDashboardId_location_idx";

ALTER TABLE "ProductionScheduleRowNote"
  DROP COLUMN IF EXISTS "location";

ALTER TABLE "ProductionScheduleRowNote"
  ADD CONSTRAINT "ProductionScheduleRowNote_csvDashboardRowId_key"
  UNIQUE ("csvDashboardRowId");
CREATE INDEX IF NOT EXISTS "ProductionScheduleRowNote_csvDashboardId_idx"
  ON "ProductionScheduleRowNote"("csvDashboardId");

-- 2) ProductionScheduleSeibanDueDate を製番単位で統合
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "csvDashboardId", "fseiban"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "ProductionScheduleSeibanDueDate"
)
DELETE FROM "ProductionScheduleSeibanDueDate"
WHERE "id" IN (
  SELECT "id"
  FROM ranked
  WHERE rn > 1
);

ALTER TABLE "ProductionScheduleSeibanDueDate"
  DROP CONSTRAINT IF EXISTS "ProductionScheduleSeibanDueDate_csvDashboardId_location_fseiban_key";
DROP INDEX IF EXISTS "ProductionScheduleSeibanDueDate_csvDashboardId_location_dueDate_idx";

ALTER TABLE "ProductionScheduleSeibanDueDate"
  DROP COLUMN IF EXISTS "location";

ALTER TABLE "ProductionScheduleSeibanDueDate"
  ADD CONSTRAINT "ProductionScheduleSeibanDueDate_csvDashboardId_fseiban_key"
  UNIQUE ("csvDashboardId", "fseiban");
CREATE INDEX IF NOT EXISTS "ProductionScheduleSeibanDueDate_csvDashboardId_dueDate_idx"
  ON "ProductionScheduleSeibanDueDate"("csvDashboardId", "dueDate");

-- 3) ProductionSchedulePartProcessingType を部品単位で統合
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "csvDashboardId", "fhincd"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "ProductionSchedulePartProcessingType"
)
DELETE FROM "ProductionSchedulePartProcessingType"
WHERE "id" IN (
  SELECT "id"
  FROM ranked
  WHERE rn > 1
);

ALTER TABLE "ProductionSchedulePartProcessingType"
  DROP CONSTRAINT IF EXISTS "ProductionSchedulePartProcessingType_unique_part";
DROP INDEX IF EXISTS "ProductionSchedulePartProcessingType_idx_location";
DROP INDEX IF EXISTS "ProductionSchedulePartProcessingType_idx_processingType";

ALTER TABLE "ProductionSchedulePartProcessingType"
  DROP COLUMN IF EXISTS "location";

ALTER TABLE "ProductionSchedulePartProcessingType"
  ADD CONSTRAINT "ProductionSchedulePartProcessingType_unique_part"
  UNIQUE ("csvDashboardId", "fhincd");
CREATE INDEX IF NOT EXISTS "ProductionSchedulePartProcessingType_idx_dashboard"
  ON "ProductionSchedulePartProcessingType"("csvDashboardId");
CREATE INDEX IF NOT EXISTS "ProductionSchedulePartProcessingType_idx_processingType"
  ON "ProductionSchedulePartProcessingType"("csvDashboardId", "processingType");
