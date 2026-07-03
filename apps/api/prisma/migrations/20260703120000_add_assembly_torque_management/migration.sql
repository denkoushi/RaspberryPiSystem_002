CREATE TYPE "AssemblyWorkSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TYPE "AssemblyTorqueInputSource" AS ENUM ('MANUAL', 'MOCK', 'AGENT');

CREATE TYPE "AssemblyTorqueRecordJudgement" AS ENUM ('OK', 'NG', 'IGNORED');

CREATE TABLE "AssemblyProcedureDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageRelativePath" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyProcedureDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyTemplate" (
    "id" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "procedurePattern" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "procedureDocumentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyTemplateArea" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "processNo" TEXT NOT NULL,
    "areaCode" TEXT NOT NULL,
    "areaName" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "requireManualAdvance" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyTemplateArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyTemplateBolt" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "tighteningId" TEXT NOT NULL,
    "markerNo" INTEGER NOT NULL,
    "xRatio" DECIMAL(10,8) NOT NULL,
    "yRatio" DECIMAL(10,8) NOT NULL,
    "boltSpec" TEXT NOT NULL,
    "nominalTorque" DECIMAL(18,6) NOT NULL,
    "lowerLimit" DECIMAL(18,6) NOT NULL,
    "upperLimit" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyTemplateBolt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyWorkSession" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "AssemblyWorkSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "productNo" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "nameplateNo" TEXT NOT NULL,
    "operatorEmployeeId" TEXT,
    "operatorNameSnapshot" TEXT NOT NULL,
    "targetUnit" TEXT NOT NULL,
    "torqueWrenchId" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT,
    "currentAreaId" TEXT,
    "currentBoltId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyWorkSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyTorqueRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "templateBoltId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "inputSource" "AssemblyTorqueInputSource" NOT NULL DEFAULT 'MANUAL',
    "rawPayload" JSONB,
    "value" DECIMAL(18,6),
    "judgement" "AssemblyTorqueRecordJudgement" NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "ignoredReason" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyTorqueRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyAreaRestartLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyAreaRestartLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssemblyProcedureDocument_idx_active_name"
ON "AssemblyProcedureDocument"("isActive", "name");

CREATE UNIQUE INDEX "AssemblyTemplate_unique_model_pattern_version"
ON "AssemblyTemplate"("modelCode", "procedurePattern", "version");

CREATE INDEX "AssemblyTemplate_idx_model_pattern_active"
ON "AssemblyTemplate"("modelCode", "procedurePattern", "isActive");

CREATE INDEX "AssemblyTemplate_idx_document"
ON "AssemblyTemplate"("procedureDocumentId");

CREATE UNIQUE INDEX "AssemblyTemplateArea_unique_template_sort"
ON "AssemblyTemplateArea"("templateId", "sortOrder");

CREATE INDEX "AssemblyTemplateArea_idx_template"
ON "AssemblyTemplateArea"("templateId");

CREATE UNIQUE INDEX "AssemblyTemplateBolt_unique_area_sort"
ON "AssemblyTemplateBolt"("areaId", "sortOrder");

CREATE UNIQUE INDEX "AssemblyTemplateBolt_unique_area_tightening"
ON "AssemblyTemplateBolt"("areaId", "tighteningId");

CREATE INDEX "AssemblyTemplateBolt_idx_area_marker"
ON "AssemblyTemplateBolt"("areaId", "markerNo");

CREATE INDEX "AssemblyWorkSession_idx_status_updated"
ON "AssemblyWorkSession"("status", "updatedAt");

CREATE INDEX "AssemblyWorkSession_idx_product_status"
ON "AssemblyWorkSession"("productNo", "status");

CREATE INDEX "AssemblyWorkSession_idx_template_status"
ON "AssemblyWorkSession"("templateId", "status");

CREATE UNIQUE INDEX "AssemblyTorqueRecord_unique_attempt"
ON "AssemblyTorqueRecord"("sessionId", "templateBoltId", "attempt");

CREATE INDEX "AssemblyTorqueRecord_idx_session_recorded"
ON "AssemblyTorqueRecord"("sessionId", "recordedAt");

CREATE INDEX "AssemblyTorqueRecord_idx_bolt"
ON "AssemblyTorqueRecord"("templateBoltId");

CREATE INDEX "AssemblyAreaRestartLog_idx_session_created"
ON "AssemblyAreaRestartLog"("sessionId", "createdAt");

CREATE INDEX "AssemblyAreaRestartLog_idx_area"
ON "AssemblyAreaRestartLog"("areaId");

ALTER TABLE "AssemblyTemplate"
ADD CONSTRAINT "AssemblyTemplate_procedureDocumentId_fkey"
FOREIGN KEY ("procedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyTemplateArea"
ADD CONSTRAINT "AssemblyTemplateArea_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "AssemblyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyTemplateBolt"
ADD CONSTRAINT "AssemblyTemplateBolt_areaId_fkey"
FOREIGN KEY ("areaId") REFERENCES "AssemblyTemplateArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyWorkSession"
ADD CONSTRAINT "AssemblyWorkSession_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "AssemblyTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyTorqueRecord"
ADD CONSTRAINT "AssemblyTorqueRecord_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyTorqueRecord"
ADD CONSTRAINT "AssemblyTorqueRecord_templateBoltId_fkey"
FOREIGN KEY ("templateBoltId") REFERENCES "AssemblyTemplateBolt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssemblyAreaRestartLog"
ADD CONSTRAINT "AssemblyAreaRestartLog_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
