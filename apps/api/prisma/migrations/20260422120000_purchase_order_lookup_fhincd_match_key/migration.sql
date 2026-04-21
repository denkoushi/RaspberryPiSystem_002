-- AlterTable: 照合キー列（TS の normalizePurchaseFhinCdForMatching と同一ロジックでバックフィル）
ALTER TABLE "PurchaseOrderLookupRow" ADD COLUMN "purchasePartCodeMatchKey" VARCHAR(128);

UPDATE "PurchaseOrderLookupRow"
SET "purchasePartCodeMatchKey" = trim(
  regexp_replace(
    regexp_replace(trim("purchasePartCodeRaw"), '\([^)]*\)', '', 'g'),
    '(-[0-9]+)+$',
    '',
    'g'
  )
);

-- 重複行は最新 updatedAt（同順位なら id）を残す
DELETE FROM "PurchaseOrderLookupRow" pol
WHERE pol."id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "sourceCsvDashboardId", "purchaseOrderNo", "seiban", "purchasePartCodeMatchKey"
        ORDER BY "updatedAt" DESC, "id" DESC
      ) AS rn
    FROM "PurchaseOrderLookupRow"
  ) sub
  WHERE sub.rn > 1
);

ALTER TABLE "PurchaseOrderLookupRow" ALTER COLUMN "purchasePartCodeMatchKey" SET NOT NULL;

-- DropIndex (旧: 正規化FHINCD 一意)
DROP INDEX IF EXISTS "POLookup_unique_src_po_seiban_nfhincd";

-- CreateIndex (照合キー一意)
CREATE UNIQUE INDEX "POLookup_unique_src_po_seiban_matchkey" ON "PurchaseOrderLookupRow"("sourceCsvDashboardId", "purchaseOrderNo", "seiban", "purchasePartCodeMatchKey");
