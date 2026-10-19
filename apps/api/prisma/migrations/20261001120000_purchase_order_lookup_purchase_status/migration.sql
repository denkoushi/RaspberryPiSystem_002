-- FKOBAINO 購買CSVの FKOBAIST（入荷ステイタス）を保持し、ボードの材料入荷バッジ照合用の索引を足す。Additive only.
ALTER TABLE "PurchaseOrderLookupRow" ADD COLUMN "purchaseStatus" VARCHAR(8);

CREATE INDEX "POLookup_idx_seiban_matchkey" ON "PurchaseOrderLookupRow"("seiban", "purchasePartCodeMatchKey");
