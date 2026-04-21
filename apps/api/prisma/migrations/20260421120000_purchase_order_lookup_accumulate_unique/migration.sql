-- Deduplicate before adding unique constraint (keep latest updatedAt, then id).
DELETE FROM "PurchaseOrderLookupRow" pol
WHERE pol."id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "sourceCsvDashboardId", "purchaseOrderNo", "seiban", "purchasePartCodeNormalized"
        ORDER BY "updatedAt" DESC, "id" DESC
      ) AS rn
    FROM "PurchaseOrderLookupRow"
  ) sub
  WHERE sub.rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "POLookup_unique_src_po_seiban_nfhincd" ON "PurchaseOrderLookupRow"("sourceCsvDashboardId", "purchaseOrderNo", "seiban", "purchasePartCodeNormalized");
