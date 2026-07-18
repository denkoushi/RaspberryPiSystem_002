-- CreateEnum
CREATE TYPE "AssemblyTorqueTraceabilityMode" AS ENUM ('LEGACY', 'REQUIRED');

-- Existing templates and records remain LEGACY-compatible. Keep the legacy
-- free-text wrench columns NOT NULL for an expand-only rollout. REQUIRED rows
-- store an empty compatibility value; physical-wrench identity is recorded by
-- the new confirmation and torque-record relations below.

ALTER TABLE "AssemblyTemplate"
  ADD COLUMN "traceabilityMode" "AssemblyTorqueTraceabilityMode" NOT NULL DEFAULT 'LEGACY';

-- Add templateId as nullable first so existing bolt rows can be backfilled from
-- their owning area without renumbering markers.
ALTER TABLE "AssemblyTemplateBolt"
  ADD COLUMN "templateId" TEXT,
  ADD COLUMN "nominalDiameter" TEXT,
  ADD COLUMN "boltLengthMm" DECIMAL(10,3),
  ADD COLUMN "material" TEXT,
  ADD COLUMN "strengthClass" TEXT,
  ADD COLUMN "capabilityGroupId" TEXT;

UPDATE "AssemblyTemplateBolt" AS bolt
SET "templateId" = area."templateId"
FROM "AssemblyTemplateArea" AS area
WHERE area."id" = bolt."areaId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AssemblyTemplateBolt"
    WHERE "templateId" IS NULL
  ) THEN
    RAISE EXCEPTION 'AssemblyTemplateBolt.templateId backfill failed: an area reference could not be resolved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AssemblyTemplateBolt"
    GROUP BY "templateId", "markerNo"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Assembly template marker numbers must be unique across the entire template; resolve existing duplicates before migration';
  END IF;
END $$;

ALTER TABLE "AssemblyTemplateBolt"
  ALTER COLUMN "templateId" SET NOT NULL;

-- Extend torque results with immutable physical-wrench and setting snapshots.
ALTER TABLE "AssemblyTorqueRecord"
  ADD COLUMN "inputUnit" TEXT,
  ADD COLUMN "valueNm" DECIMAL(18,6),
  ADD COLUMN "torqueWrenchProfileId" TEXT,
  ADD COLUMN "confirmationId" TEXT,
  ADD COLUMN "settingHistoryId" TEXT,
  ADD COLUMN "serialNumberSnapshot" TEXT,
  ADD COLUMN "manufacturerSnapshot" TEXT,
  ADD COLUMN "modelNumberSnapshot" TEXT,
  ADD COLUMN "settingLowerLimitSnapshot" DECIMAL(18,6),
  ADD COLUMN "settingNominalTorqueSnapshot" DECIMAL(18,6),
  ADD COLUMN "settingUpperLimitSnapshot" DECIMAL(18,6),
  ADD COLUMN "settingUnitSnapshot" TEXT,
  ADD COLUMN "sourceClientDeviceId" TEXT,
  ADD COLUMN "sourceEventKey" TEXT,
  ADD COLUMN "expectedTemplateBoltId" TEXT,
  ADD COLUMN "deviceRecordedAt" TIMESTAMP(3),
  ADD COLUMN "deviceMemoryCounter" TEXT,
  ADD COLUMN "deviceJudgement" TEXT,
  ADD COLUMN "overrideActorUserId" TEXT,
  ADD COLUMN "overrideActorUsername" TEXT,
  ADD COLUMN "overrideReason" TEXT;

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

  CONSTRAINT "TorqueWrenchModel_pkey" PRIMARY KEY ("id")
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

  CONSTRAINT "TorqueWrenchProfile_pkey" PRIMARY KEY ("id")
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

  CONSTRAINT "TorqueWrenchCapabilityGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TorqueWrenchCapabilityGroupModel" (
  "capabilityGroupId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TorqueWrenchCapabilityGroupModel_pkey" PRIMARY KEY ("capabilityGroupId", "modelId")
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

  CONSTRAINT "TorqueWrenchSettingHistory_pkey" PRIMARY KEY ("id")
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

  CONSTRAINT "AssemblyTorqueWrenchConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TorqueWrenchModel_unique_manufacturer_model_key"
  ON "TorqueWrenchModel"("manufacturerKey", "modelNumberKey");
CREATE INDEX "TorqueWrenchModel_idx_active_keys"
  ON "TorqueWrenchModel"("isActive", "manufacturerKey", "modelNumberKey");

CREATE UNIQUE INDEX "TorqueWrenchProfile_measuringInstrumentId_key"
  ON "TorqueWrenchProfile"("measuringInstrumentId");
CREATE UNIQUE INDEX "TorqueWrenchProfile_serialNumberKey_key"
  ON "TorqueWrenchProfile"("serialNumberKey");
CREATE INDEX "TorqueWrenchProfile_idx_model"
  ON "TorqueWrenchProfile"("modelId");

CREATE UNIQUE INDEX "TorqueWrenchCapabilityGroup_name_key"
  ON "TorqueWrenchCapabilityGroup"("name");
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

CREATE UNIQUE INDEX "AssemblyTemplateArea_unique_id_template"
  ON "AssemblyTemplateArea"("id", "templateId");
CREATE UNIQUE INDEX "AssemblyTemplateBolt_unique_template_marker"
  ON "AssemblyTemplateBolt"("templateId", "markerNo");
CREATE INDEX "AssemblyTemplateBolt_idx_capability_group"
  ON "AssemblyTemplateBolt"("capabilityGroupId");

CREATE UNIQUE INDEX "AssemblyTorqueRecord_unique_source_event"
  ON "AssemblyTorqueRecord"("sourceClientDeviceId", "sourceEventKey");
CREATE INDEX "AssemblyTorqueRecord_idx_profile_recorded"
  ON "AssemblyTorqueRecord"("torqueWrenchProfileId", "recordedAt");
CREATE INDEX "AssemblyTorqueRecord_idx_profile_memory_recorded"
  ON "AssemblyTorqueRecord"("torqueWrenchProfileId", "deviceMemoryCounter", "recordedAt");
CREATE INDEX "AssemblyTorqueRecord_idx_confirmation"
  ON "AssemblyTorqueRecord"("confirmationId");
CREATE INDEX "AssemblyTorqueRecord_idx_setting"
  ON "AssemblyTorqueRecord"("settingHistoryId");

-- Replace the area-only relation with a composite relation that proves every
-- bolt's denormalized templateId matches its actual owning area.
ALTER TABLE "AssemblyTemplateBolt"
  DROP CONSTRAINT "AssemblyTemplateBolt_areaId_fkey";

ALTER TABLE "TorqueWrenchProfile"
  ADD CONSTRAINT "TorqueWrenchProfile_measuringInstrumentId_fkey"
  FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TorqueWrenchProfile"
  ADD CONSTRAINT "TorqueWrenchProfile_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "TorqueWrenchModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TorqueWrenchCapabilityGroupModel"
  ADD CONSTRAINT "TorqueWrenchCapabilityGroupModel_capabilityGroupId_fkey"
  FOREIGN KEY ("capabilityGroupId") REFERENCES "TorqueWrenchCapabilityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TorqueWrenchCapabilityGroupModel"
  ADD CONSTRAINT "TorqueWrenchCapabilityGroupModel_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "TorqueWrenchModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TorqueWrenchSettingHistory"
  ADD CONSTRAINT "TorqueWrenchSettingHistory_torqueWrenchProfileId_fkey"
  FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyTemplateBolt"
  ADD CONSTRAINT "AssemblyTemplateBolt_areaId_templateId_fkey"
  FOREIGN KEY ("areaId", "templateId") REFERENCES "AssemblyTemplateArea"("id", "templateId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyTemplateBolt"
  ADD CONSTRAINT "AssemblyTemplateBolt_capabilityGroupId_fkey"
  FOREIGN KEY ("capabilityGroupId") REFERENCES "TorqueWrenchCapabilityGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD CONSTRAINT "AssemblyTorqueWrenchConfirmation_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD CONSTRAINT "AssemblyTorqueWrenchConfirmation_templateBoltId_fkey"
  FOREIGN KEY ("templateBoltId") REFERENCES "AssemblyTemplateBolt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD CONSTRAINT "AssemblyTorqueWrenchConfirmation_torqueWrenchProfileId_fkey"
  FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyTorqueWrenchConfirmation"
  ADD CONSTRAINT "AssemblyTorqueWrenchConfirmation_settingHistoryId_fkey"
  FOREIGN KEY ("settingHistoryId") REFERENCES "TorqueWrenchSettingHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyTorqueRecord"
  ADD CONSTRAINT "AssemblyTorqueRecord_torqueWrenchProfileId_fkey"
  FOREIGN KEY ("torqueWrenchProfileId") REFERENCES "TorqueWrenchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyTorqueRecord"
  ADD CONSTRAINT "AssemblyTorqueRecord_confirmationId_fkey"
  FOREIGN KEY ("confirmationId") REFERENCES "AssemblyTorqueWrenchConfirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyTorqueRecord"
  ADD CONSTRAINT "AssemblyTorqueRecord_settingHistoryId_fkey"
  FOREIGN KEY ("settingHistoryId") REFERENCES "TorqueWrenchSettingHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
