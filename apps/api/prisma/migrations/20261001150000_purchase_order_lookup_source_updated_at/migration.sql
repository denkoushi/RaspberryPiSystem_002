-- FKOBAINO 購買CSVの FUPDTEDT（元システムの更新日時）を保持し、古いCSVの後追い取込で新しい行を上書きしないようにする。Additive only.
ALTER TABLE "PurchaseOrderLookupRow" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
