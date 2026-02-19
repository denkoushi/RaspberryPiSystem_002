-- CreateTable
CREATE TABLE "ProductionScheduleProgress" (
    "csvDashboardRowId" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleProgress_pkey" PRIMARY KEY ("csvDashboardRowId")
);

-- CreateIndex
CREATE INDEX "ProductionScheduleProgress_csvDashboardId_isCompleted_idx" ON "ProductionScheduleProgress"("csvDashboardId", "isCompleted");

-- AddForeignKey
ALTER TABLE "ProductionScheduleProgress" ADD CONSTRAINT "ProductionScheduleProgress_csvDashboardRowId_fkey" FOREIGN KEY ("csvDashboardRowId") REFERENCES "CsvDashboardRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration (hard cutover): copy existing completion state from rowData JSON.
-- Note: progress is global (shared across kiosks).
INSERT INTO "ProductionScheduleProgress" ("csvDashboardRowId", "csvDashboardId", "isCompleted", "createdAt", "updatedAt")
SELECT
  r."id" AS "csvDashboardRowId",
  '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01' AS "csvDashboardId",
  TRUE AS "isCompleted",
  CURRENT_TIMESTAMP AS "createdAt",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "CsvDashboardRow" AS r
WHERE r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND TRIM(COALESCE(r."rowData"->>'progress', '')) = '完了'
ON CONFLICT ("csvDashboardRowId")
DO UPDATE SET
  "isCompleted" = EXCLUDED."isCompleted",
  "updatedAt" = EXCLUDED."updatedAt";

