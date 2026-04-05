-- CreateTable
CREATE TABLE "PartMeasurementSession" (
    "id" TEXT NOT NULL,
    "productNo" TEXT NOT NULL,
    "processGroup" "PartMeasurementProcessGroup" NOT NULL,
    "resourceCd" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMeasurementSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartMeasurementSession_unique_business_key" ON "PartMeasurementSession"("productNo", "processGroup", "resourceCd");

-- CreateIndex
CREATE INDEX "PartMeasurementSession_productNo_processGroup_idx" ON "PartMeasurementSession"("productNo", "processGroup");

-- AlterTable
ALTER TABLE "PartMeasurementSheet" ADD COLUMN "sessionId" TEXT;

-- Backfill sessions from existing sheets (1 parent per business key)
INSERT INTO "PartMeasurementSession" ("id", "productNo", "processGroup", "resourceCd", "completedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  trim(both FROM s."productNo"),
  s."processGroupSnapshot",
  COALESCE(NULLIF(trim(both FROM s."resourceCdSnapshot"), ''), '__LEGACY__'),
  NULL,
  MIN(s."createdAt"),
  MAX(s."updatedAt")
FROM "PartMeasurementSheet" s
GROUP BY
  trim(both FROM s."productNo"),
  s."processGroupSnapshot",
  COALESCE(NULLIF(trim(both FROM s."resourceCdSnapshot"), ''), '__LEGACY__');

-- Attach sheets to sessions
UPDATE "PartMeasurementSheet" AS s
SET "sessionId" = sess."id"
FROM "PartMeasurementSession" AS sess
WHERE trim(both FROM s."productNo") = sess."productNo"
  AND s."processGroupSnapshot" = sess."processGroup"
  AND COALESCE(NULLIF(trim(both FROM s."resourceCdSnapshot"), ''), '__LEGACY__') = sess."resourceCd";

-- Backfill completedAt using the same rule as the service:
-- no draft remains, at least one relevant sheet exists, and all relevant sheets are finalized.
UPDATE "PartMeasurementSession" AS sess
SET "completedAt" = agg."completedAt"
FROM (
  SELECT
    s."sessionId",
    CASE
      WHEN COUNT(*) FILTER (WHERE s."status" = 'DRAFT') > 0 THEN NULL
      WHEN COUNT(*) FILTER (WHERE s."status" NOT IN ('CANCELLED', 'INVALIDATED')) = 0 THEN NULL
      WHEN COUNT(*) FILTER (WHERE s."status" NOT IN ('CANCELLED', 'INVALIDATED', 'FINALIZED')) = 0
        THEN MAX(COALESCE(s."finalizedAt", s."updatedAt"))
      ELSE NULL
    END AS "completedAt"
  FROM "PartMeasurementSheet" AS s
  WHERE s."sessionId" IS NOT NULL
  GROUP BY s."sessionId"
) AS agg
WHERE sess."id" = agg."sessionId";

-- Drop old unique indexes (multiple sheets per session allowed)
DROP INDEX IF EXISTS "PartMeasurementSheet_unique_draft_business_key";
DROP INDEX IF EXISTS "PartMeasurementSheet_unique_finalized_business_key";

-- NotNull sessionId
ALTER TABLE "PartMeasurementSheet" ALTER COLUMN "sessionId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "PartMeasurementSheet" ADD CONSTRAINT "PartMeasurementSheet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PartMeasurementSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "PartMeasurementSheet_idx_session" ON "PartMeasurementSheet"("sessionId");
