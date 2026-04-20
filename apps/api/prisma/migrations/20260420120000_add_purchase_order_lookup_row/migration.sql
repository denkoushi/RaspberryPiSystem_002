-- CreateTable
CREATE TABLE "PurchaseOrderLookupRow" (
    "id" TEXT NOT NULL,
    "sourceCsvDashboardId" TEXT NOT NULL,
    "purchaseOrderNo" VARCHAR(20) NOT NULL,
    "purchasePartCodeRaw" VARCHAR(128) NOT NULL,
    "purchasePartCodeNormalized" VARCHAR(128) NOT NULL,
    "seiban" VARCHAR(64) NOT NULL,
    "purchasePartName" VARCHAR(500) NOT NULL,
    "acceptedQuantity" INTEGER NOT NULL DEFAULT 0,
    "lineIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLookupRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "POLookup_idx_purchaseOrderNo" ON "PurchaseOrderLookupRow"("purchaseOrderNo");

-- CreateIndex
CREATE INDEX "POLookup_idx_sourceDashboard" ON "PurchaseOrderLookupRow"("sourceCsvDashboardId");
