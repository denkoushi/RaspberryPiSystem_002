-- CreateTable
CREATE TABLE "SelfInspectionLotEntryInstrumentUsage" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "measuringInstrumentId" TEXT,
    "loanId" TEXT,
    "measuringInstrumentManagementNumberSnapshot" TEXT NOT NULL,
    "measuringInstrumentNameSnapshot" TEXT NOT NULL,
    "measuringInstrumentTagUidSnapshot" TEXT,
    "preUseInspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionLotEntryInstrumentUsage_pkey" PRIMARY KEY ("id")
);

-- Backfill the previous single-instrument snapshot into the new usage table.
-- Historical rows do not get synthetic Loan records; loanId stays NULL.
INSERT INTO "SelfInspectionLotEntryInstrumentUsage" (
  "id",
  "entryId",
  "measuringInstrumentId",
  "loanId",
  "measuringInstrumentManagementNumberSnapshot",
  "measuringInstrumentNameSnapshot",
  "measuringInstrumentTagUidSnapshot",
  "preUseInspectedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  entry."id",
  entry."measuringInstrumentId",
  NULL,
  COALESCE(entry."measuringInstrumentManagementNumberSnapshot", instrument."managementNumber"),
  COALESCE(entry."measuringInstrumentNameSnapshot", instrument."name"),
  entry."measuringInstrumentTagUidSnapshot",
  entry."updatedAt",
  entry."createdAt",
  entry."updatedAt"
FROM "SelfInspectionLotEntry" AS entry
LEFT JOIN "MeasuringInstrument" AS instrument
  ON instrument."id" = entry."measuringInstrumentId"
WHERE entry."measuringInstrumentId" IS NOT NULL
  AND COALESCE(entry."measuringInstrumentManagementNumberSnapshot", instrument."managementNumber") IS NOT NULL
  AND COALESCE(entry."measuringInstrumentNameSnapshot", instrument."name") IS NOT NULL
ON CONFLICT DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionLotEntryInstrumentUsage_unique_entry_instrument"
  ON "SelfInspectionLotEntryInstrumentUsage"("entryId", "measuringInstrumentId");

-- CreateIndex
CREATE INDEX "SelfInspectionLotEntryInstrumentUsage_idx_entry"
  ON "SelfInspectionLotEntryInstrumentUsage"("entryId");

-- CreateIndex
CREATE INDEX "SelfInspectionLotEntryInstrumentUsage_idx_instrument"
  ON "SelfInspectionLotEntryInstrumentUsage"("measuringInstrumentId");

-- CreateIndex
CREATE INDEX "SelfInspectionLotEntryInstrumentUsage_idx_loan"
  ON "SelfInspectionLotEntryInstrumentUsage"("loanId");

-- AddForeignKey
ALTER TABLE "SelfInspectionLotEntryInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionLotEntryInstrumentUsage_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "SelfInspectionLotEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionLotEntryInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionLotEntryInstrumentUsage_measuringInstrumentId_fkey"
  FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionLotEntryInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionLotEntryInstrumentUsage_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
