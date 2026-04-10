-- CreateTable
CREATE TABLE "MobilePlacementEvent" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "shelfCodeRaw" TEXT NOT NULL,
    "itemBarcodeRaw" TEXT NOT NULL,
    "itemId" TEXT,
    "csvDashboardRowId" TEXT,
    "scheduleSnapshot" JSONB,
    "previousStorageLocation" TEXT,
    "newStorageLocation" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilePlacementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MobilePlacementEvent_clientDeviceId_placedAt_idx" ON "MobilePlacementEvent"("clientDeviceId", "placedAt");

-- CreateIndex
CREATE INDEX "MobilePlacementEvent_itemId_idx" ON "MobilePlacementEvent"("itemId");

-- AddForeignKey
ALTER TABLE "MobilePlacementEvent" ADD CONSTRAINT "MobilePlacementEvent_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilePlacementEvent" ADD CONSTRAINT "MobilePlacementEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
