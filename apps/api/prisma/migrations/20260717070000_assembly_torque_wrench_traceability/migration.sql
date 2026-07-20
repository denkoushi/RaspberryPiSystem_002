-- Expand-only rollout contract:
-- - existing tables receive nullable built-in columns only;
-- - existing LEGACY rows are not rewritten during deploy;
-- - foreign keys and uniqueness owned by new tables are declared at CREATE time;
-- - contract/backfill work for legacy rows is intentionally deferred.

-- Existing templates have NULL here and are interpreted as LEGACY by the API.
-- Every newly created/revised template writes LEGACY or REQUIRED explicitly.
ALTER TABLE "AssemblyTemplate" ADD COLUMN "traceabilityMode" TEXT;

-- Structured bolt requirements. templateId remains nullable for pre-existing
-- LEGACY rows; all newly created/revised templates write it explicitly.
ALTER TABLE "AssemblyTemplateBolt" ADD COLUMN "templateId" TEXT;
ALTER TABLE "AssemblyTemplateBolt" ADD COLUMN "nominalDiameter" TEXT;
ALTER TABLE "AssemblyTemplateBolt" ADD COLUMN "boltLengthMm" DECIMAL(10,3);
ALTER TABLE "AssemblyTemplateBolt" ADD COLUMN "material" TEXT;
ALTER TABLE "AssemblyTemplateBolt" ADD COLUMN "strengthClass" TEXT;
ALTER TABLE "AssemblyTemplateBolt" ADD COLUMN "capabilityGroupId" TEXT;

-- Immutable traceability snapshots on existing torque records.
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "inputUnit" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "valueNm" DECIMAL(18,6);
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "torqueWrenchProfileId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "confirmationId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "settingHistoryId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "serialNumberSnapshot" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "manufacturerSnapshot" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "modelNumberSnapshot" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "settingLowerLimitSnapshot" DECIMAL(18,6);
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "settingNominalTorqueSnapshot" DECIMAL(18,6);
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "settingUpperLimitSnapshot" DECIMAL(18,6);
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "settingUnitSnapshot" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "sourceClientDeviceId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "sourceEventKey" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "expectedTemplateBoltId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "deviceRecordedAt" TIMESTAMP(3);
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "deviceMemoryCounter" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "deviceJudgement" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "overrideActorUserId" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "overrideActorUsername" TEXT;
ALTER TABLE "AssemblyTorqueRecord" ADD COLUMN "overrideReason" TEXT;

-- Torque-wrench model master (shared by multiple physical instruments).
CREATE TABLE "TorqueWrenchModel" (
  "id" TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "manufacturerKey" TEXT NOT NULL,
  "modelNumber" TEXT NOT NULL,
  "modelNumberKey" TEXT NOT NULL,
  "torqueMinNm" DECIMAL(18,6) NOT NULL,
  "torqueMaxNm" DECIMAL(18,6) NOT NULL,
  "resolutionNm" DECIMAL(18,6),
  "communicationType" TEXT NOT NULL DEFAULT 'BLUETOOTH_HOGP',
  "outputProfile" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TorqueWrenchModel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TorqueWrenchModel_unique_manufacturer_model_key" UNIQUE ("manufacturerKey", "modelNumberKey")
);

-- Physical wrench profile; calibration, state and storage remain owned by
-- MeasuringInstrument.
CREATE TABLE "TorqueWrenchProfile" (
  "id" TEXT NOT NULL,
  "measuringInstrumentId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "serialNumberKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TorqueWrenchProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TorqueWrenchProfile_measuringInstrumentId_key" UNIQUE ("measuringInstrumentId"),
  CONSTRAINT "TorqueWrenchProfile_serialNumberKey_key" UNIQUE ("serialNumberKey"),
  CONSTRAINT "TorqueWrenchProfile_measuringInstrumentId_fkey"
    FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TorqueWrenchProfile_modelId_fkey"
    FOREIGN KEY ("modelId") REFERENCES "TorqueWrenchModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TorqueWrenchCapabilityGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nominalDiameter" TEXT NOT NULL,
  "boltLengthMm" DECIMAL(10,3) NOT NULL,
  "material" TEXT NOT NULL,
  "strengthClass" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TorqueWrenchCapabilityGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TorqueWrenchCapabilityGroup_name_key" UNIQUE ("name")
);

CREATE TABLE "TorqueWrenchCapabilityGroupModel" (
  "capabilityGroupId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TorqueWrenchCapabilityGroupModel_pkey" PRIMARY KEY ("capabilityGroupId", "modelId"),
  CONSTRAINT "TorqueWrenchCapabilityGroupModel_capabilityGroupId_fkey"
    FOREIGN KEY ("capabilityGroupId") REFERENCES "TorqueWrenchCapabilityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TorqueWrenchCapabilityGroupModel_modelId_fkey"
    FOREIGN KEY ("modelId") REFERENCES "TorqueWrenchModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Append-only setting history. Services never update or delete these rows.
CREATE TABLE "TorqueWrenchSettingHistory" (
  "id" TEXT NOT NULL,
  "torqueWrenchProfileId" TEXT NOT NULL,
  "lowerLimit" DECIMAL(18,6) NOT NULL,
  "nominalTorque" DECIMAL(18,6) NOT NULL,
  "upperLimit" DECIMAL(18,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "lowerLimitNm" DECIMAL(18,6) NOT NULL,
  "nominalTorqueNm" DECIMAL(18,6) NOT NULL,
  "upperLimitNm" DECIMAL(18,6) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" TEXT,
  "actorUsername" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TorqueWrenchSettingHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TorqueWrenchSettingHistory_torqueWrenchProfileId_fkey"
    FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AssemblyTorqueWrenchConfirmation" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "templateBoltId" TEXT NOT NULL,
  "torqueWrenchProfileId" TEXT NOT NULL,
  "settingHistoryId" TEXT NOT NULL,
  "conditionFingerprint" TEXT NOT NULL,
  "operatorEmployeeId" TEXT,
  "operatorNameSnapshot" TEXT NOT NULL,
  "clientDeviceId" TEXT,
  "clientDeviceNameSnapshot" TEXT,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssemblyTorqueWrenchConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssemblyTorqueWrenchConfirmation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssemblyTorqueWrenchConfirmation_templateBoltId_fkey"
    FOREIGN KEY ("templateBoltId") REFERENCES "AssemblyTemplateBolt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyTorqueWrenchConfirmation_torqueWrenchProfileId_fkey"
    FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyTorqueWrenchConfirmation_settingHistoryId_fkey"
    FOREIGN KEY ("settingHistoryId") REFERENCES "TorqueWrenchSettingHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- A separate append-only claim table gives clientDeviceId + eventId a real
-- database uniqueness boundary without adding a contract constraint to the
-- already-live AssemblyTorqueRecord table.
CREATE TABLE "AssemblyTorqueAgentEvent" (
  "sourceClientDeviceId" TEXT NOT NULL,
  "sourceEventKey" TEXT NOT NULL,
  "torqueRecordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssemblyTorqueAgentEvent_pkey" PRIMARY KEY ("sourceClientDeviceId", "sourceEventKey"),
  CONSTRAINT "AssemblyTorqueAgentEvent_torqueRecordId_key" UNIQUE ("torqueRecordId"),
  CONSTRAINT "AssemblyTorqueAgentEvent_torqueRecordId_fkey"
    FOREIGN KEY ("torqueRecordId") REFERENCES "AssemblyTorqueRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TorqueWrenchModel_idx_active_keys"
  ON "TorqueWrenchModel"("isActive", "manufacturerKey", "modelNumberKey");
CREATE INDEX "TorqueWrenchProfile_idx_model"
  ON "TorqueWrenchProfile"("modelId");
CREATE INDEX "TorqueWrenchCapabilityGroup_idx_fastener_active"
  ON "TorqueWrenchCapabilityGroup"("nominalDiameter", "boltLengthMm", "material", "strengthClass", "isActive");
CREATE INDEX "TorqueWrenchCapabilityGroupModel_idx_model_group"
  ON "TorqueWrenchCapabilityGroupModel"("modelId", "capabilityGroupId");
CREATE INDEX "TorqueWrenchSettingHistory_idx_profile_effective"
  ON "TorqueWrenchSettingHistory"("torqueWrenchProfileId", "effectiveAt" DESC, "createdAt" DESC);
CREATE INDEX "AssemblyTorqueWrenchConfirmation_idx_session_condition"
  ON "AssemblyTorqueWrenchConfirmation"("sessionId", "conditionFingerprint", "confirmedAt" DESC);
CREATE INDEX "AssemblyTorqueWrenchConfirmation_idx_profile_confirmed"
  ON "AssemblyTorqueWrenchConfirmation"("torqueWrenchProfileId", "confirmedAt" DESC);
CREATE INDEX "AssemblyTorqueWrenchConfirmation_idx_setting"
  ON "AssemblyTorqueWrenchConfirmation"("settingHistoryId");
CREATE INDEX "AssemblyTemplateBolt_idx_template_marker"
  ON "AssemblyTemplateBolt"("templateId", "markerNo");
CREATE INDEX "AssemblyTemplateBolt_idx_capability_group"
  ON "AssemblyTemplateBolt"("capabilityGroupId");
CREATE INDEX "AssemblyTorqueRecord_idx_source_event"
  ON "AssemblyTorqueRecord"("sourceClientDeviceId", "sourceEventKey");
CREATE INDEX "AssemblyTorqueRecord_idx_profile_recorded"
  ON "AssemblyTorqueRecord"("torqueWrenchProfileId", "recordedAt");
CREATE INDEX "AssemblyTorqueRecord_idx_profile_memory_recorded"
  ON "AssemblyTorqueRecord"("torqueWrenchProfileId", "deviceMemoryCounter", "recordedAt");
CREATE INDEX "AssemblyTorqueRecord_idx_confirmation"
  ON "AssemblyTorqueRecord"("confirmationId");
CREATE INDEX "AssemblyTorqueRecord_idx_setting"
  ON "AssemblyTorqueRecord"("settingHistoryId");
