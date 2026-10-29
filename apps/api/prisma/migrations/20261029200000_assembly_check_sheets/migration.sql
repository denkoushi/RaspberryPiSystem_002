-- CreateEnum
CREATE TYPE "AssemblyCheckSheetInputKind" AS ENUM ('OK_NG', 'NUMBER', 'TEXT', 'CHOICE', 'NONE');

-- CreateEnum
CREATE TYPE "AssemblyCheckSheetStatus" AS ENUM ('IN_PROGRESS', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssemblyCheckSheetResult" AS ENUM ('OK', 'NG', 'NA');

-- CreateTable
CREATE TABLE "AssemblyCheckSheetAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "originalFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyCheckSheetAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyCheckSheetRevision" (
    "id" TEXT NOT NULL,
    "revisionRootId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "isRevisionHead" BOOLEAN NOT NULL DEFAULT true,
    "documentNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "revisionLabel" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "sourceSheetName" TEXT NOT NULL,
    "layoutSnapshot" JSONB,
    "headerCellMap" JSONB NOT NULL,
    "stampColumn" TEXT NOT NULL,
    "departmentRoleMembers" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyCheckSheetRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyCheckSheetRevision_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "AssemblyCheckSheetAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheetRevision_revisionRootId_fkey" FOREIGN KEY ("revisionRootId") REFERENCES "AssemblyCheckSheetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssemblyCheckSheetGroup" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "groupNo" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "AssemblyCheckSheetGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyCheckSheetGroup_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AssemblyCheckSheetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetGroup_unique_number" ON "AssemblyCheckSheetGroup"("revisionId", "groupNo");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetGroup_unique_revision" ON "AssemblyCheckSheetGroup"("id", "revisionId");

-- CreateTable
CREATE TABLE "AssemblyCheckSheetItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "inputKind" "AssemblyCheckSheetInputKind" NOT NULL,
    "inputSpec" JSONB NOT NULL,
    "roleKeys" TEXT[],
    "conditionKey" TEXT,
    "conditionLabel" TEXT,
    "sourceRows" INTEGER[],
    "stampCell" TEXT NOT NULL,
    "valueTarget" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,

    CONSTRAINT "AssemblyCheckSheetItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyCheckSheetItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AssemblyCheckSheetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheetItem_groupId_revisionId_fkey" FOREIGN KEY ("groupId", "revisionId") REFERENCES "AssemblyCheckSheetGroup"("id", "revisionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssemblyCheckSheet" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "status" "AssemblyCheckSheetStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "headerValues" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedByEmployeeId" TEXT,
    "completedByEmployeeCodeSnapshot" TEXT,
    "completedByEmployeeNameSnapshot" TEXT,
    "completedByNfcTagUidSnapshot" TEXT,
    "completedByPositionNameSnapshot" TEXT,
    "pausedReason" TEXT,
    "clientDeviceId" TEXT,

    CONSTRAINT "AssemblyCheckSheet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyCheckSheet_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "AssemblySerialRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheet_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AssemblyCheckSheetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheet_completed_employee_fkey" FOREIGN KEY ("completedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssemblyCheckSheetStamp" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "result" "AssemblyCheckSheetResult" NOT NULL,
    "values" JSONB NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "employeeId" TEXT,
    "employeeCodeSnapshot" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "nfcTagUidSnapshot" TEXT NOT NULL,
    "positionNameSnapshot" TEXT,
    "clientDeviceId" TEXT,
    "stampedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyCheckSheetStamp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyCheckSheetStamp_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AssemblyCheckSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheetStamp_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AssemblyCheckSheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheetStamp_employee_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssemblyCheckSheetStampHistory" (
    "id" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "result" "AssemblyCheckSheetResult" NOT NULL,
    "values" JSONB NOT NULL,
    "flagged" BOOLEAN NOT NULL,
    "employeeId" TEXT,
    "employeeCodeSnapshot" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "nfcTagUidSnapshot" TEXT NOT NULL,
    "positionNameSnapshot" TEXT,
    "clientDeviceId" TEXT,
    "stampedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyCheckSheetStampHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssemblyCheckSheetStampHistory_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AssemblyCheckSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheetStampHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AssemblyCheckSheetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssemblyCheckSheetStampHistory_employee_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetAsset_storageKey_key" ON "AssemblyCheckSheetAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetAsset_sha256_key" ON "AssemblyCheckSheetAsset"("sha256");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheetRevision_idx_head" ON "AssemblyCheckSheetRevision"("revisionRootId", "isRevisionHead");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheetRevision_idx_asset" ON "AssemblyCheckSheetRevision"("sourceAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetRevision_unique_root_number" ON "AssemblyCheckSheetRevision"("revisionRootId", "revisionNumber");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheetItem_idx_group" ON "AssemblyCheckSheetItem"("groupId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetItem_unique_key" ON "AssemblyCheckSheetItem"("revisionId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetItem_unique_stamp_cell" ON "AssemblyCheckSheetItem"("revisionId", "stampCell");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheet_workUnitId_key" ON "AssemblyCheckSheet"("workUnitId");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheet_idx_revision" ON "AssemblyCheckSheet"("revisionId");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheetStamp_idx_item" ON "AssemblyCheckSheetStamp"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyCheckSheetStamp_unique_item" ON "AssemblyCheckSheetStamp"("sheetId", "itemId");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheetStampHistory_idx_item" ON "AssemblyCheckSheetStampHistory"("sheetId", "itemId", "supersededAt");

-- CreateIndex
CREATE INDEX "AssemblyCheckSheetStampHistory_idx_item_id" ON "AssemblyCheckSheetStampHistory"("itemId");

-- A lineage has at most one head, including writes outside the save service.
CREATE UNIQUE INDEX "AssemblyCheckSheetRevision_unique_head"
  ON "AssemblyCheckSheetRevision"("revisionRootId") WHERE "isRevisionHead" = true;
