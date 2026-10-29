CREATE TYPE "MobileScanFrameKind" AS ENUM ('scan_frame', 'placement_photo');
CREATE TABLE "mobile_scan_frames" (
  "id" TEXT NOT NULL,
  "clientFrameId" TEXT NOT NULL,
  "kind" "MobileScanFrameKind" NOT NULL,
  "clientDeviceId" TEXT NOT NULL,
  "clientRecordId" TEXT,
  "orderPlacementEventId" TEXT,
  "shelfCodeRaw" TEXT,
  "slipKind" TEXT,
  "decodedValue" TEXT,
  "manualValue" TEXT,
  "outcome" TEXT NOT NULL,
  "decodeMs" INTEGER NOT NULL,
  "retryCount" INTEGER NOT NULL,
  "engine" TEXT NOT NULL,
  "camera" JSONB NOT NULL,
  "torchOn" BOOLEAN,
  "zoom" DOUBLE PRECISION,
  "cropBox" JSONB,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "cropKey" TEXT,
  "fullKey" TEXT NOT NULL,
  "cropBytes" INTEGER,
  "fullBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_scan_frames_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mobile_scan_frames_clientFrameId_key" ON "mobile_scan_frames"("clientFrameId");
CREATE INDEX "mobile_scan_frames_kind_capturedAt_idx" ON "mobile_scan_frames"("kind", "capturedAt");
CREATE INDEX "mobile_scan_frames_shelfCodeRaw_idx" ON "mobile_scan_frames"("shelfCodeRaw");
CREATE INDEX "mobile_scan_frames_clientRecordId_idx" ON "mobile_scan_frames"("clientRecordId");
ALTER TABLE "mobile_scan_frames" ADD CONSTRAINT "mobile_scan_frames_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mobile_scan_frames" ADD CONSTRAINT "mobile_scan_frames_orderPlacementEventId_fkey" FOREIGN KEY ("orderPlacementEventId") REFERENCES "OrderPlacementEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
