-- Add inspector remeasurement records without backfilling existing approval-pending sessions.
CREATE TYPE "SelfInspectionInspectorMeasurementJudgementStatus" AS ENUM ('NOT_EVALUATED');

ALTER TABLE "SelfInspectionSession"
ADD COLUMN "inspectorRemeasurementRequiredAt" TIMESTAMP(3);

CREATE TABLE "SelfInspectionInspectorEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entryIndex" INTEGER NOT NULL,
    "entrySlotKind" "SelfInspectionEntrySlotKind" NOT NULL DEFAULT 'FIXED',
    "inspectorEmployeeId" TEXT,
    "inspectorEmployeeCodeSnapshot" TEXT,
    "inspectorEmployeeNameSnapshot" TEXT,
    "inspectorEmployeeNfcTagUidSnapshot" TEXT,
    "measuringInstrumentId" TEXT,
    "measuringInstrumentManagementNumberSnapshot" TEXT,
    "measuringInstrumentNameSnapshot" TEXT,
    "measuringInstrumentTagUidSnapshot" TEXT,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionInspectorEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SelfInspectionInspectorEntryInstrumentUsage" (
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

    CONSTRAINT "SelfInspectionInspectorEntryInstrumentUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SelfInspectionInspectorMeasurementValue" (
    "id" TEXT NOT NULL,
    "inspectorEntryId" TEXT NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "operatorMeasurementValueId" TEXT,
    "operatorValueSnapshot" DECIMAL(18,6),
    "inspectorValue" DECIMAL(18,6),
    "differenceValue" DECIMAL(18,6),
    "judgementStatus" "SelfInspectionInspectorMeasurementJudgementStatus" NOT NULL DEFAULT 'NOT_EVALUATED',
    "judgedAt" TIMESTAMP(3),
    "judgementComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionInspectorMeasurementValue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SelfInspectionSession_idx_inspector_remeasurement_required_at"
ON "SelfInspectionSession"("inspectorRemeasurementRequiredAt");

CREATE UNIQUE INDEX "SelfInspectionInspectorEntry_unique_session_entry"
ON "SelfInspectionInspectorEntry"("sessionId", "entryIndex");

CREATE INDEX "SelfInspectionInspectorEntry_idx_session"
ON "SelfInspectionInspectorEntry"("sessionId");

CREATE INDEX "SelfInspectionInspectorEntry_idx_inspector_employee"
ON "SelfInspectionInspectorEntry"("inspectorEmployeeId");

CREATE INDEX "SelfInspectionInspectorEntry_idx_measuring_instrument"
ON "SelfInspectionInspectorEntry"("measuringInstrumentId");

CREATE INDEX "SelfInspectionInspectorEntry_idx_client_device"
ON "SelfInspectionInspectorEntry"("clientDeviceId");

CREATE UNIQUE INDEX "SelfInspectionInspectorEntryUsage_unique_entry_instrument"
ON "SelfInspectionInspectorEntryInstrumentUsage"("entryId", "measuringInstrumentId");

CREATE INDEX "SelfInspectionInspectorEntryUsage_idx_entry"
ON "SelfInspectionInspectorEntryInstrumentUsage"("entryId");

CREATE INDEX "SelfInspectionInspectorEntryUsage_idx_instrument"
ON "SelfInspectionInspectorEntryInstrumentUsage"("measuringInstrumentId");

CREATE INDEX "SelfInspectionInspectorEntryUsage_idx_loan"
ON "SelfInspectionInspectorEntryInstrumentUsage"("loanId");

CREATE UNIQUE INDEX "SelfInspectionInspectorValue_unique_entry_item"
ON "SelfInspectionInspectorMeasurementValue"("inspectorEntryId", "templateItemId");

CREATE INDEX "SelfInspectionInspectorValue_idx_entry"
ON "SelfInspectionInspectorMeasurementValue"("inspectorEntryId");

CREATE INDEX "SelfInspectionInspectorValue_idx_template_item"
ON "SelfInspectionInspectorMeasurementValue"("templateItemId");

CREATE INDEX "SelfInspectionInspectorValue_idx_operator_value"
ON "SelfInspectionInspectorMeasurementValue"("operatorMeasurementValueId");

CREATE INDEX "SelfInspectionInspectorValue_idx_judgement_status"
ON "SelfInspectionInspectorMeasurementValue"("judgementStatus");

ALTER TABLE "SelfInspectionInspectorEntry"
ADD CONSTRAINT "SelfInspectionInspectorEntry_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorEntry"
ADD CONSTRAINT "SelfInspectionInspectorEntry_inspectorEmployeeId_fkey"
FOREIGN KEY ("inspectorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorEntry"
ADD CONSTRAINT "SelfInspectionInspectorEntry_measuringInstrumentId_fkey"
FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorEntry"
ADD CONSTRAINT "SelfInspectionInspectorEntry_clientDeviceId_fkey"
FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorEntryInstrumentUsage"
ADD CONSTRAINT "SelfInspectionInspectorEntryInstrumentUsage_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "SelfInspectionInspectorEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorEntryInstrumentUsage"
ADD CONSTRAINT "SelfInspectionInspectorEntryInstrumentUsage_measuringInstrumentId_fkey"
FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorEntryInstrumentUsage"
ADD CONSTRAINT "SelfInspectionInspectorEntryInstrumentUsage_loanId_fkey"
FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorMeasurementValue"
ADD CONSTRAINT "SelfInspectionInspectorMeasurementValue_inspectorEntryId_fkey"
FOREIGN KEY ("inspectorEntryId") REFERENCES "SelfInspectionInspectorEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorMeasurementValue"
ADD CONSTRAINT "SelfInspectionInspectorMeasurementValue_templateItemId_fkey"
FOREIGN KEY ("templateItemId") REFERENCES "PartMeasurementTemplateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInspectorMeasurementValue"
ADD CONSTRAINT "SelfInspectionInspectorMeasurementValue_operatorMeasurementValueId_fkey"
FOREIGN KEY ("operatorMeasurementValueId") REFERENCES "SelfInspectionMeasurementValue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
