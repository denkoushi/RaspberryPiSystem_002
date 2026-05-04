-- Zero2W / ヘッドレス配膳追跡（棚番エッジ）
ALTER TABLE "ClientDevice" ADD COLUMN "haizenPresetShelfCodeRaw" TEXT;

CREATE TABLE "HaizenScanEvent" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "presetShelfCodeRaw" TEXT NOT NULL,
    "manufacturingOrderBarcodeRaw" TEXT NOT NULL,
    "distributionNumber" INTEGER,
    "rawBarcode" TEXT,
    "csvDashboardRowId" TEXT,
    "scheduleSnapshot" JSONB,
    "resolutionStatus" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaizenScanEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HaizenCurrentPlacement" (
    "id" TEXT NOT NULL,
    "manufacturingOrderBarcodeRaw" TEXT NOT NULL,
    "shelfCodeRaw" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "distributionNumber" INTEGER,
    "csvDashboardRowId" TEXT,
    "scheduleSnapshot" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaizenCurrentPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HaizenCurrentPlacement_manufacturingOrderBarcodeRaw_key" ON "HaizenCurrentPlacement"("manufacturingOrderBarcodeRaw");

CREATE INDEX "HaizenScanEvent_clientDeviceId_createdAt_idx" ON "HaizenScanEvent"("clientDeviceId", "createdAt");

CREATE INDEX "HaizenScanEvent_manufacturingOrderBarcodeRaw_idx" ON "HaizenScanEvent"("manufacturingOrderBarcodeRaw");

CREATE INDEX "HaizenScanEvent_resolutionStatus_createdAt_idx" ON "HaizenScanEvent"("resolutionStatus", "createdAt");

CREATE INDEX "HaizenCurrentPlacement_shelfCodeRaw_idx" ON "HaizenCurrentPlacement"("shelfCodeRaw");

CREATE INDEX "HaizenCurrentPlacement_clientDeviceId_idx" ON "HaizenCurrentPlacement"("clientDeviceId");

ALTER TABLE "HaizenScanEvent" ADD CONSTRAINT "HaizenScanEvent_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HaizenCurrentPlacement" ADD CONSTRAINT "HaizenCurrentPlacement_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
