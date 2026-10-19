-- Employee-bound work-instruction editor authentication and append-only audit.
-- Existing revisions remain valid and are intentionally not backfilled.

CREATE TYPE "WorkInstructionEditAuditAction" AS ENUM (
  'DRAFT_CREATED',
  'SAVED',
  'PUBLISHED',
  'DISCARDED',
  'ASSET_UPLOADED',
  'REGION_CREATED',
  'SOURCE_IMAGE_DELETED'
);

CREATE TABLE "WorkInstructionEditorAuthentication" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" TEXT,
  "employeeCodeSnapshot" VARCHAR(120) NOT NULL,
  "employeeNameSnapshot" VARCHAR(200) NOT NULL,
  "clientDeviceId" TEXT,
  "clientDeviceNameSnapshot" VARCHAR(200) NOT NULL,
  "partNumber" VARCHAR(200) NOT NULL,
  "shootingTarget" VARCHAR(200) NOT NULL,
  "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkInstructionEditorAuthentication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionEditorAuthentication_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditorAuthentication_clientDeviceId_fkey"
    FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditorAuthentication_expiry_check"
    CHECK ("expiresAt" > "authenticatedAt")
);

CREATE INDEX "WorkInstructionEditorAuth_idx_employee_time"
  ON "WorkInstructionEditorAuthentication"("employeeId", "authenticatedAt");
CREATE INDEX "WorkInstructionEditorAuth_idx_device_expiry"
  ON "WorkInstructionEditorAuthentication"("clientDeviceId", "expiresAt");
CREATE INDEX "WorkInstructionEditorAuth_idx_group_time"
  ON "WorkInstructionEditorAuthentication"("partNumber", "shootingTarget", "authenticatedAt");

CREATE TABLE "WorkInstructionEditAuditLog" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "authenticationId" TEXT NOT NULL,
  "action" "WorkInstructionEditAuditAction" NOT NULL,
  "employeeIdSnapshot" VARCHAR(120) NOT NULL,
  "employeeCodeSnapshot" VARCHAR(120) NOT NULL,
  "employeeNameSnapshot" VARCHAR(200) NOT NULL,
  "clientDeviceIdSnapshot" VARCHAR(120) NOT NULL,
  "clientDeviceNameSnapshot" VARCHAR(200) NOT NULL,
  "partNumber" VARCHAR(200) NOT NULL,
  "shootingTarget" VARCHAR(200) NOT NULL,
  "rowId" TEXT,
  "sourceVersionId" TEXT,
  "revisionId" TEXT,
  "editVersionBefore" INTEGER,
  "editVersionAfter" INTEGER,
  "requestId" VARCHAR(120) NOT NULL,
  "changeSet" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionEditAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionEditAuditLog_authenticationId_fkey"
    FOREIGN KEY ("authenticationId") REFERENCES "WorkInstructionEditorAuthentication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditAuditLog_rowId_fkey"
    FOREIGN KEY ("rowId") REFERENCES "WorkInstructionRow"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditAuditLog_sourceVersionId_fkey"
    FOREIGN KEY ("sourceVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditAuditLog_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "WorkInstructionEditAudit_idx_group_time"
  ON "WorkInstructionEditAuditLog"("partNumber", "shootingTarget", "createdAt");
CREATE INDEX "WorkInstructionEditAudit_idx_revision_time"
  ON "WorkInstructionEditAuditLog"("revisionId", "createdAt");
CREATE INDEX "WorkInstructionEditAudit_idx_auth_time"
  ON "WorkInstructionEditAuditLog"("authenticationId", "createdAt");
CREATE INDEX "WorkInstructionEditAudit_idx_request"
  ON "WorkInstructionEditAuditLog"("requestId");
