-- 作業用ID（旧 AssemblySerialRegistry）に対する構成履歴と正式ID履歴を追加する。
-- 既存の AssemblySerialRegistry / serialNo は物理的に改名しない。

CREATE TABLE "AssemblyWorkUnitComposition" (
    "id" TEXT NOT NULL,
    "parentWorkUnitId" TEXT NOT NULL,
    "childWorkUnitId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedByUsernameSnapshot" TEXT,
    "linkedByClientDeviceId" TEXT,
    "linkedByClientDeviceNameSnapshot" TEXT,
    "unlinkedAt" TIMESTAMP(3),
    "unlinkedByUsernameSnapshot" TEXT,
    "unlinkedByClientDeviceId" TEXT,
    "unlinkedByClientDeviceNameSnapshot" TEXT,
    "unlinkReason" TEXT,

    CONSTRAINT "AssemblyWorkUnitComposition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyFormalIdentifierAssignment" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "formalId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUsernameSnapshot" TEXT,
    "assignedByClientDeviceId" TEXT,
    "assignedByClientDeviceNameSnapshot" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByUsernameSnapshot" TEXT,
    "supersededByClientDeviceId" TEXT,
    "supersededByClientDeviceNameSnapshot" TEXT,
    "supersedeReason" TEXT,

    CONSTRAINT "AssemblyFormalIdentifierAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssemblyFormalIdentifierAssignment_formalId_key"
  ON "AssemblyFormalIdentifierAssignment"("formalId");
CREATE INDEX "AssemblyFormalIdentifierAssignment_idx_work_unit_active"
  ON "AssemblyFormalIdentifierAssignment"("workUnitId", "supersededAt");
CREATE INDEX "AssemblyWorkUnitComposition_idx_parent_active"
  ON "AssemblyWorkUnitComposition"("parentWorkUnitId", "unlinkedAt");
CREATE INDEX "AssemblyWorkUnitComposition_idx_child_active"
  ON "AssemblyWorkUnitComposition"("childWorkUnitId", "unlinkedAt");

-- PostgreSQLの部分一意索引で「現在有効な親は子ごとに1つ」を保証する。
CREATE UNIQUE INDEX "AssemblyWorkUnitComposition_unique_active_child"
  ON "AssemblyWorkUnitComposition"("childWorkUnitId")
  WHERE "unlinkedAt" IS NULL;
CREATE UNIQUE INDEX "AssemblyFormalIdentifierAssignment_unique_active_work_unit"
  ON "AssemblyFormalIdentifierAssignment"("workUnitId")
  WHERE "supersededAt" IS NULL;

ALTER TABLE "AssemblyWorkUnitComposition"
  ADD CONSTRAINT "AssemblyWorkUnitComposition_parentWorkUnitId_fkey"
  FOREIGN KEY ("parentWorkUnitId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyWorkUnitComposition"
  ADD CONSTRAINT "AssemblyWorkUnitComposition_childWorkUnitId_fkey"
  FOREIGN KEY ("childWorkUnitId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyFormalIdentifierAssignment"
  ADD CONSTRAINT "AssemblyFormalIdentifierAssignment_workUnitId_fkey"
  FOREIGN KEY ("workUnitId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
