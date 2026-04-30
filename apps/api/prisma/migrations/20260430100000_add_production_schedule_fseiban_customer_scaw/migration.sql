-- CreateTable
CREATE TABLE "ProductionScheduleFseibanCustomerScaw" (
    "id" TEXT NOT NULL,
    "sourceCsvDashboardId" TEXT NOT NULL,
    "fseiban" VARCHAR(64) NOT NULL,
    "customerName" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleFseibanCustomerScaw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PSFseibanCustScaw_unique_src_fsb" ON "ProductionScheduleFseibanCustomerScaw"("sourceCsvDashboardId", "fseiban");

-- CreateIndex
CREATE INDEX "PSFseibanCustScaw_idx_fseiban" ON "ProductionScheduleFseibanCustomerScaw"("fseiban");
