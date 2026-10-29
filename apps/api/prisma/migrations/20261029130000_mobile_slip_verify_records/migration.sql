CREATE TYPE "MobileSlipVerifyOutcome" AS ENUM ('match', 'mismatch', 'not_found', 'error');
CREATE TABLE "mobile_slip_verify_records" (
  "id" TEXT NOT NULL,
  "clientVerifyId" TEXT NOT NULL,
  "clientDeviceId" TEXT NOT NULL,
  "transferOrderBarcodeRaw" TEXT NOT NULL,
  "actualOrderBarcodeRaw" TEXT NOT NULL,
  "actualFseibanRaw" TEXT NOT NULL,
  "transferPartRaw" TEXT,
  "actualPartRaw" TEXT,
  "reason" TEXT,
  "expectedFseiban" TEXT,
  "expectedFhincd" TEXT,
  "expectedPartName" TEXT,
  "actualResolvedFseiban" TEXT,
  "actualPartCode" TEXT,
  "matchedBy" TEXT,
  "clientRecordId" TEXT,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "outcome" "MobileSlipVerifyOutcome" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_slip_verify_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mobile_slip_verify_records_clientVerifyId_key" ON "mobile_slip_verify_records"("clientVerifyId");
CREATE INDEX "mobile_slip_verify_records_verifiedAt_idx" ON "mobile_slip_verify_records"("verifiedAt");
CREATE INDEX "mobile_slip_verify_records_transferOrderBarcodeRaw_idx" ON "mobile_slip_verify_records"("transferOrderBarcodeRaw");
ALTER TABLE "mobile_slip_verify_records" ADD CONSTRAINT "mobile_slip_verify_records_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
