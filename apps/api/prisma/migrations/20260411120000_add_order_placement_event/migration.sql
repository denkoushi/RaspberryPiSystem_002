-- CreateTable
CREATE TABLE "OrderPlacementEvent" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "shelfCodeRaw" TEXT NOT NULL,
    "manufacturingOrderBarcodeRaw" TEXT NOT NULL,
    "csvDashboardRowId" TEXT,
    "scheduleSnapshot" JSONB,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPlacementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPlacementEvent_clientDeviceId_placedAt_idx" ON "OrderPlacementEvent"("clientDeviceId", "placedAt");

-- AddForeignKey
ALTER TABLE "OrderPlacementEvent" ADD CONSTRAINT "OrderPlacementEvent_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
