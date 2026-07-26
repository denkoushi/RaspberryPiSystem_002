-- 組立ロット登録時の作業者入力を廃止し、作業開始・再開ごとのNFC履歴と
-- WorkUnitの不可逆な論理無効化を追加する。
-- 既存の作業用ID、作業、トルク、検査、承認、構成、正式ID履歴は変更・削除しない。

CREATE TYPE "AssemblyOperatorAccessType" AS ENUM ('START', 'RESUME');
CREATE TYPE "AssemblyWorkUnitInvalidationState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED');

ALTER TABLE "AssemblySerialRegistry"
  ADD COLUMN "invalidatedAt" TIMESTAMP(3);

CREATE TABLE "AssemblyWorkSessionOperatorAccess" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT,
    "accessType" "AssemblyOperatorAccessType" NOT NULL,
    "requestId" VARCHAR(120) NOT NULL,
    "employeeCodeSnapshot" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "employeeNfcTagUidSnapshot" TEXT NOT NULL,
    "clientDeviceId" TEXT,
    "clientDeviceNameSnapshot" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyWorkSessionOperatorAccess_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyWorkSessionOperatorAccess_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "AssemblyWorkSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyWorkSessionOperatorAccess_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssemblyWorkSessionOperatorAccess_clientDeviceId_fkey"
      FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AssemblyWorkUnitInvalidation" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "requestId" VARCHAR(120) NOT NULL,
    "sourceState" "AssemblyWorkUnitInvalidationState" NOT NULL,
    "productNoSnapshot" TEXT,
    "workIdSnapshot" TEXT NOT NULL,
    "lotIdSnapshot" TEXT,
    "lotSerialIdSnapshot" TEXT,
    "workSessionIdSnapshot" TEXT,
    "reason" TEXT NOT NULL,
    "invalidatedByUsernameSnapshot" TEXT,
    "invalidatedByClientDeviceId" TEXT,
    "invalidatedByClientDeviceNameSnapshot" TEXT,
    "invalidatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyWorkUnitInvalidation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyWorkUnitInvalidation_workUnitId_fkey"
      FOREIGN KEY ("workUnitId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyWorkUnitInvalidation_invalidatedByClientDeviceId_fkey"
      FOREIGN KEY ("invalidatedByClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssemblyWorkUnitInvalidation_reason_not_blank"
      CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX "AssemblyWorkSessionOperatorAccess_requestId_key"
  ON "AssemblyWorkSessionOperatorAccess"("requestId");
CREATE INDEX "AssemblyOperatorAccess_idx_session_accessed"
  ON "AssemblyWorkSessionOperatorAccess"("sessionId", "accessedAt");
CREATE INDEX "AssemblyOperatorAccess_idx_employee_accessed"
  ON "AssemblyWorkSessionOperatorAccess"("employeeId", "accessedAt");
CREATE INDEX "AssemblyOperatorAccess_idx_client_accessed"
  ON "AssemblyWorkSessionOperatorAccess"("clientDeviceId", "accessedAt");

CREATE UNIQUE INDEX "AssemblyWorkUnitInvalidation_workUnitId_key"
  ON "AssemblyWorkUnitInvalidation"("workUnitId");
CREATE UNIQUE INDEX "AssemblyWorkUnitInvalidation_requestId_key"
  ON "AssemblyWorkUnitInvalidation"("requestId");
CREATE INDEX "AssemblyWorkUnitInvalidation_idx_invalidated"
  ON "AssemblyWorkUnitInvalidation"("invalidatedAt");
CREATE INDEX "AssemblyWorkUnitInvalidation_idx_client_time"
  ON "AssemblyWorkUnitInvalidation"("invalidatedByClientDeviceId", "invalidatedAt");
CREATE INDEX "AssemblyWorkUnit_idx_invalidation_updated"
  ON "AssemblySerialRegistry"("invalidatedAt", "updatedAt");
