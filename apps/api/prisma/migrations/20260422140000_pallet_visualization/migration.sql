-- CreateEnum
CREATE TYPE "MachinePalletEventActionType" AS ENUM ('SET_ITEM', 'REPLACE_ITEM', 'DELETE_ITEM', 'CLEAR_PALLET', 'UPSERT_ILLUSTRATION', 'DELETE_ILLUSTRATION');

-- CreateTable
CREATE TABLE "PalletMachineIllustration" (
    "resourceCd" VARCHAR(20) NOT NULL,
    "imageRelativeUrl" VARCHAR(512) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PalletMachineIllustration_pkey" PRIMARY KEY ("resourceCd")
);

-- CreateTable
CREATE TABLE "MachinePalletItem" (
    "id" TEXT NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "palletNo" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "fhincd" VARCHAR(120) NOT NULL,
    "fhinmei" VARCHAR(255) NOT NULL,
    "fseiban" VARCHAR(120) NOT NULL,
    "machineName" VARCHAR(255),
    "csvDashboardRowId" TEXT,
    "scheduleSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachinePalletItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachinePalletEvent" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "actionType" "MachinePalletEventActionType" NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "palletNo" INTEGER,
    "affectedItemId" TEXT,
    "manufacturingOrderBarcodeRaw" TEXT,
    "illustrationRelativeUrl" VARCHAR(512),
    "scheduleSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachinePalletEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachinePalletItem_idx_machine_pallet_order" ON "MachinePalletItem"("resourceCd", "palletNo", "displayOrder");

-- CreateIndex
CREATE INDEX "MachinePalletItem_idx_resource" ON "MachinePalletItem"("resourceCd");

-- CreateIndex
CREATE INDEX "MachinePalletEvent_idx_device_time" ON "MachinePalletEvent"("clientDeviceId", "createdAt");

-- CreateIndex
CREATE INDEX "MachinePalletEvent_idx_resource_time" ON "MachinePalletEvent"("resourceCd", "createdAt");

-- AddForeignKey
ALTER TABLE "MachinePalletEvent" ADD CONSTRAINT "MachinePalletEvent_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
