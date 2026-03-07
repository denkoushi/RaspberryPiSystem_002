-- FHINCD単位の表面処理マスタ
CREATE TABLE "ProductionSchedulePartProcessingType" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "fhincd" VARCHAR(50) NOT NULL,
  "processingType" VARCHAR(20) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionSchedulePartProcessingType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionSchedulePartProcessingType_unique_part"
  ON "ProductionSchedulePartProcessingType"("csvDashboardId", "location", "fhincd");

CREATE INDEX "ProductionSchedulePartProcessingType_idx_location"
  ON "ProductionSchedulePartProcessingType"("csvDashboardId", "location");

CREATE INDEX "ProductionSchedulePartProcessingType_idx_processingType"
  ON "ProductionSchedulePartProcessingType"("csvDashboardId", "location", "processingType");

-- 表面処理候補マスタ（location単位）
CREATE TABLE "ProductionScheduleProcessingTypeOption" (
  "id" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "label" VARCHAR(40) NOT NULL,
  "priority" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionScheduleProcessingTypeOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleProcessingTypeOption_unique_code"
  ON "ProductionScheduleProcessingTypeOption"("location", "code");

CREATE INDEX "ProductionScheduleProcessingTypeOption_idx_location"
  ON "ProductionScheduleProcessingTypeOption"("location", "enabled", "priority");

-- 既存RowNoteからFHINCD単位へバックフィル（最新updatedAtを優先）
WITH latest_processing AS (
  SELECT DISTINCT ON (
    n."csvDashboardId",
    n."location",
    TRIM(r."rowData"->>'FHINCD')
  )
    n."csvDashboardId" AS csv_dashboard_id,
    n."location" AS location,
    TRIM(r."rowData"->>'FHINCD') AS fhincd,
    TRIM(n."processingType") AS processing_type,
    n."updatedAt" AS updated_at,
    n."createdAt" AS created_at
  FROM "ProductionScheduleRowNote" AS n
  INNER JOIN "CsvDashboardRow" AS r
    ON r."id" = n."csvDashboardRowId"
  WHERE n."processingType" IS NOT NULL
    AND TRIM(n."processingType") <> ''
    AND TRIM(COALESCE(r."rowData"->>'FHINCD', '')) <> ''
  ORDER BY
    n."csvDashboardId",
    n."location",
    TRIM(r."rowData"->>'FHINCD'),
    n."updatedAt" DESC,
    n."createdAt" DESC
)
INSERT INTO "ProductionSchedulePartProcessingType" (
  "id",
  "csvDashboardId",
  "location",
  "fhincd",
  "processingType",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('part-processing:', lp.csv_dashboard_id, ':', lp.location, ':', lp.fhincd),
  lp.csv_dashboard_id,
  lp.location,
  lp.fhincd,
  lp.processing_type,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM latest_processing lp
ON CONFLICT ("csvDashboardId", "location", "fhincd")
DO UPDATE SET
  "processingType" = EXCLUDED."processingType",
  "updatedAt" = CURRENT_TIMESTAMP;

-- 既定候補をlocationごとに初期投入
WITH locations AS (
  SELECT 'shared'::TEXT AS "location"
  UNION
  SELECT DISTINCT TRIM("location")
  FROM "ProductionScheduleRowNote"
  WHERE TRIM(COALESCE("location", '')) <> ''
  UNION
  SELECT DISTINCT TRIM("location")
  FROM "ProductionScheduleResourceCategoryConfig"
  WHERE TRIM(COALESCE("location", '')) <> ''
  UNION
  SELECT DISTINCT TRIM("location")
  FROM "ClientDevice"
  WHERE TRIM(COALESCE("location", '')) <> ''
),
defaults AS (
  SELECT 1 AS "priority", 'LSLH'::TEXT AS "code", 'LSLH'::TEXT AS "label"
  UNION ALL
  SELECT 2, 'カニゼン', 'カニゼン'
  UNION ALL
  SELECT 3, '塗装', '塗装'
  UNION ALL
  SELECT 4, 'その他01', 'その他01'
  UNION ALL
  SELECT 5, 'その他02', 'その他02'
)
INSERT INTO "ProductionScheduleProcessingTypeOption" (
  "id",
  "location",
  "code",
  "label",
  "priority",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('processing-option:', l."location", ':', d."code"),
  l."location",
  d."code",
  d."label",
  d."priority",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM locations l
CROSS JOIN defaults d
ON CONFLICT ("location", "code") DO NOTHING;
