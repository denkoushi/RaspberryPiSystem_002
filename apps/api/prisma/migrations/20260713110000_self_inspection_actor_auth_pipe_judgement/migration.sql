-- Additive migration: existing template items stay numeric and existing measurement rows remain untouched.
CREATE TYPE "PartMeasurementValueKind" AS ENUM ('NUMERIC', 'JUDGEMENT');
CREATE TYPE "SelfInspectionMeasurementActorMode" AS ENUM ('OPERATOR', 'INSPECTOR');
CREATE TYPE "SelfInspectionMeasurementOperationKind" AS ENUM ('DRAFT_AUTOSAVED', 'ENTRY_CONFIRMED', 'INSTRUMENT_PRE_USE');

ALTER TABLE "PartMeasurementTemplateItem"
  ADD COLUMN "valueKind" "PartMeasurementValueKind" NOT NULL DEFAULT 'NUMERIC';

ALTER TABLE "SelfInspectionMeasurementValue"
  ADD COLUMN "judgementResult" "InspectionResult";

ALTER TABLE "SelfInspectionInspectorMeasurementValue"
  ADD COLUMN "operatorJudgementResultSnapshot" "InspectionResult",
  ADD COLUMN "inspectorJudgementResult" "InspectionResult";

CREATE TABLE "SelfInspectionMeasurementActorAuthentication" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "mode" "SelfInspectionMeasurementActorMode" NOT NULL,
  "employeeId" TEXT,
  "employeeCodeSnapshot" TEXT NOT NULL,
  "employeeNameSnapshot" TEXT NOT NULL,
  "employeeNfcTagUidSnapshot" TEXT NOT NULL,
  "clientDeviceId" TEXT,
  "clientDeviceNameSnapshot" TEXT,
  "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SelfInspectionMeasurementActorAuthentication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SelfInspectionMeasurementOperation" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "authenticationId" TEXT NOT NULL,
  "mode" "SelfInspectionMeasurementActorMode" NOT NULL,
  "entryIndex" INTEGER,
  "operationKind" "SelfInspectionMeasurementOperationKind" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SelfInspectionMeasurementOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SelfInspectionActorAuth_idx_session_mode_authenticated"
  ON "SelfInspectionMeasurementActorAuthentication"("sessionId", "mode", "authenticatedAt");
CREATE INDEX "SelfInspectionActorAuth_idx_client_authenticated"
  ON "SelfInspectionMeasurementActorAuthentication"("clientDeviceId", "authenticatedAt");
CREATE INDEX "SelfInspectionActorAuth_idx_employee_authenticated"
  ON "SelfInspectionMeasurementActorAuthentication"("employeeId", "authenticatedAt");
CREATE INDEX "SelfInspectionOperation_idx_session_mode_entry_occurred"
  ON "SelfInspectionMeasurementOperation"("sessionId", "mode", "entryIndex", "occurredAt");
CREATE INDEX "SelfInspectionOperation_idx_auth_occurred"
  ON "SelfInspectionMeasurementOperation"("authenticationId", "occurredAt");

ALTER TABLE "SelfInspectionMeasurementActorAuthentication"
  ADD CONSTRAINT "SelfInspectionMeasurementActorAuthentication_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SelfInspectionMeasurementActorAuthentication_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SelfInspectionMeasurementActorAuthentication_clientDeviceId_fkey"
    FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionMeasurementOperation"
  ADD CONSTRAINT "SelfInspectionMeasurementOperation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SelfInspectionMeasurementOperation_authenticationId_fkey"
    FOREIGN KEY ("authenticationId") REFERENCES "SelfInspectionMeasurementActorAuthentication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
