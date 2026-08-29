-- Additive persistence for SharePoint work-instruction row snapshots.

CREATE TYPE "WorkInstructionAssetStatus" AS ENUM ('STAGED', 'ACTIVE', 'DELETE_PENDING');

CREATE TYPE "WorkInstructionImportOutcome" AS ENUM (
    'PENDING',
    'PROCESSING',
    'APPLIED',
    'DUPLICATE',
    'STALE',
    'CONFLICT',
    'INVALID',
    'RETRYABLE'
);

CREATE TABLE "WorkInstructionRow" (
    "id" TEXT NOT NULL,
    "sourceSystem" VARCHAR(120) NOT NULL,
    "sourceList" VARCHAR(255) NOT NULL,
    "sourceItemId" BIGINT NOT NULL,
    "sourceModified" TIMESTAMP(3) NOT NULL,
    "partNumber" VARCHAR(200),
    "shootingTarget" VARCHAR(200),
    "rawManifest" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkInstructionRow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkInstructionRow_source_item_id_check" CHECK ("sourceItemId" > 0)
);

CREATE TABLE "WorkInstructionAsset" (
    "id" TEXT NOT NULL,
    "storageKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "status" "WorkInstructionAssetStatus" NOT NULL DEFAULT 'STAGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "deletePendingAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkInstructionAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkInstructionAsset_size_check" CHECK ("sizeBytes" > 0)
);

CREATE TABLE "WorkInstructionStep" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "step" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "imageName" TEXT,
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkInstructionStep_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkInstructionStep_step_check" CHECK ("step" > 0),
    CONSTRAINT "WorkInstructionStep_rowId_fkey"
      FOREIGN KEY ("rowId") REFERENCES "WorkInstructionRow"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkInstructionStep_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "WorkInstructionAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkInstructionImportMessage" (
    "id" TEXT NOT NULL,
    "gmailMessageId" VARCHAR(255) NOT NULL,
    "outcome" "WorkInstructionImportOutcome" NOT NULL,
    "error" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "mailCleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkInstructionImportMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkInstructionRow_unique_source"
  ON "WorkInstructionRow"("sourceSystem", "sourceList", "sourceItemId");
CREATE INDEX "WorkInstructionRow_idx_group"
  ON "WorkInstructionRow"("partNumber", "shootingTarget", "sourceItemId", "sourceList", "sourceSystem");
CREATE INDEX "WorkInstructionRow_idx_modified"
  ON "WorkInstructionRow"("sourceModified");

CREATE UNIQUE INDEX "WorkInstructionAsset_storageKey_key"
  ON "WorkInstructionAsset"("storageKey");
CREATE INDEX "WorkInstructionAsset_idx_status_created"
  ON "WorkInstructionAsset"("status", "createdAt");
CREATE INDEX "WorkInstructionAsset_idx_status_delete_pending"
  ON "WorkInstructionAsset"("status", "deletePendingAt");

CREATE UNIQUE INDEX "WorkInstructionStep_unique_row_step"
  ON "WorkInstructionStep"("rowId", "step");
CREATE INDEX "WorkInstructionStep_idx_asset"
  ON "WorkInstructionStep"("assetId");

CREATE UNIQUE INDEX "WorkInstructionImportMessage_gmailMessageId_key"
  ON "WorkInstructionImportMessage"("gmailMessageId");
CREATE INDEX "WorkInstructionImportMessage_idx_retry"
  ON "WorkInstructionImportMessage"("outcome", "nextRetryAt");
CREATE INDEX "WorkInstructionImportMessage_idx_cleanup"
  ON "WorkInstructionImportMessage"("mailCleanupPending", "updatedAt");
