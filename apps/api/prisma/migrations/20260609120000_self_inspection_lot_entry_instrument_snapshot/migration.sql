-- AlterTable
ALTER TABLE "SelfInspectionLotEntry" ADD COLUMN "measuringInstrumentId" TEXT,
ADD COLUMN "measuringInstrumentManagementNumberSnapshot" TEXT,
ADD COLUMN "measuringInstrumentNameSnapshot" TEXT,
ADD COLUMN "measuringInstrumentTagUidSnapshot" TEXT;

-- CreateIndex
CREATE INDEX "SelfInspectionLotEntry_idx_measuring_instrument" ON "SelfInspectionLotEntry"("measuringInstrumentId");

-- AddForeignKey
ALTER TABLE "SelfInspectionLotEntry" ADD CONSTRAINT "SelfInspectionLotEntry_measuringInstrumentId_fkey" FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
