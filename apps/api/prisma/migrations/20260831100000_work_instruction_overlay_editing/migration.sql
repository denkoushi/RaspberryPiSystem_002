-- Work-instruction source versions, publication pointers and editing sidecars.
-- This migration is expand-only. Existing latest-row data is intentionally not
-- copied here; the application backfill is idempotent and runs separately.

CREATE TYPE "WorkInstructionEditRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISCARDED');
CREATE TYPE "WorkInstructionEditOverlayKind" AS ENUM ('TEXT', 'IMAGE', 'SHAPE');
CREATE TYPE "WorkInstructionEditOverlayShapeKind" AS ENUM ('RECTANGLE', 'ELLIPSE', 'LINE', 'ARROW');
CREATE TYPE "WorkInstructionEditOverlayMigrationState" AS ENUM ('MIGRATED', 'NEEDS_REVIEW', 'UNASSIGNED', 'SKIPPED');
CREATE TYPE "WorkInstructionEditAssetStatus" AS ENUM ('STAGED', 'ACTIVE', 'DELETE_PENDING');
CREATE TYPE "WorkInstructionEditAssetOrigin" AS ENUM ('UPLOAD', 'ROI');
CREATE TYPE "WorkInstructionSourceAssetDeletionStatus" AS ENUM ('REQUESTED', 'DELETED', 'FAILED');

CREATE TABLE "WorkInstructionSourceVersion" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "rowId" TEXT NOT NULL,
  "sourceModified" TIMESTAMP(3) NOT NULL,
  "partNumber" VARCHAR(200),
  "shootingTarget" VARCHAR(200),
  "rawManifest" JSONB NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionSourceVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionSourceVersion_rowId_fkey"
    FOREIGN KEY ("rowId") REFERENCES "WorkInstructionRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkInstructionSourceVersionStep" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "sourceVersionId" TEXT NOT NULL,
  "step" BIGINT NOT NULL,
  "text" TEXT NOT NULL,
  "imageName" TEXT,
  "imageAssetId" TEXT,
  "imageSha256" VARCHAR(64),
  "imageDeletedAt" TIMESTAMP(3),
  "imageDeletedBy" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionSourceVersionStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionSourceVersionStep_step_check" CHECK ("step" > 0),
  CONSTRAINT "WorkInstructionSourceVersionStep_sourceVersionId_fkey"
    FOREIGN KEY ("sourceVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionSourceVersionStep_imageAssetId_fkey"
    FOREIGN KEY ("imageAssetId") REFERENCES "WorkInstructionAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkInstructionEditRevision" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "sourceVersionId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  "supersedesRevisionId" TEXT,
  "copiedFromRevisionId" TEXT,
  "isRevisionHead" BOOLEAN NOT NULL DEFAULT true,
  "status" "WorkInstructionEditRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "editVersion" INTEGER NOT NULL DEFAULT 0,
  "baseContentHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionEditRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionEditRevision_revisionNumber_check" CHECK ("revisionNumber" >= 1),
  CONSTRAINT "WorkInstructionEditRevision_editVersion_check" CHECK ("editVersion" >= 0),
  CONSTRAINT "WorkInstructionEditRevision_sourceVersionId_fkey"
    FOREIGN KEY ("sourceVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditRevision_supersedesRevisionId_fkey"
    FOREIGN KEY ("supersedesRevisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditRevision_copiedFromRevisionId_fkey"
    FOREIGN KEY ("copiedFromRevisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "WorkInstructionEditAsset" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "storageKey" VARCHAR(1024) NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "status" "WorkInstructionEditAssetStatus" NOT NULL DEFAULT 'STAGED',
  "origin" "WorkInstructionEditAssetOrigin" NOT NULL DEFAULT 'UPLOAD',
  "originSourceVersionId" TEXT,
  "originSourceStep" BIGINT,
  "originXRatio" DECIMAL(10,8),
  "originYRatio" DECIMAL(10,8),
  "originWidthRatio" DECIMAL(10,8),
  "originHeightRatio" DECIMAL(10,8),
  "ownerRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "deletePendingAt" TIMESTAMP(3),
  "lastDeleteError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionEditAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionEditAsset_size_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "WorkInstructionEditAsset_origin_source_step_check" CHECK ("originSourceStep" IS NULL OR "originSourceStep" > 0),
  CONSTRAINT "WorkInstructionEditAsset_origin_bbox_check" CHECK (
    ("origin" = 'UPLOAD' AND "originSourceVersionId" IS NULL AND "originSourceStep" IS NULL AND
      "originXRatio" IS NULL AND "originYRatio" IS NULL AND "originWidthRatio" IS NULL AND "originHeightRatio" IS NULL) OR
    ("origin" = 'ROI' AND "originSourceVersionId" IS NOT NULL AND "originSourceStep" IS NOT NULL AND
      "originXRatio" IS NOT NULL AND "originYRatio" IS NOT NULL AND "originWidthRatio" IS NOT NULL AND "originHeightRatio" IS NOT NULL AND
      "originXRatio" >= 0 AND "originXRatio" <= 1 AND "originYRatio" >= 0 AND "originYRatio" <= 1 AND
      "originWidthRatio" > 0 AND "originHeightRatio" > 0 AND
      "originXRatio" + "originWidthRatio" <= 1 AND "originYRatio" + "originHeightRatio" <= 1)
  ),
  CONSTRAINT "WorkInstructionEditAsset_ownerRevisionId_fkey"
    FOREIGN KEY ("ownerRevisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE
  ,CONSTRAINT "WorkInstructionEditAsset_originSourceVersionId_fkey"
    FOREIGN KEY ("originSourceVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkInstructionEditOverlay" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "revisionId" TEXT NOT NULL,
  "sourceStep" BIGINT,
  "migratedFromStep" BIGINT NOT NULL,
  "baseStepFingerprint" VARCHAR(128) NOT NULL,
  "targetStepFingerprint" VARCHAR(128),
  "migrationState" "WorkInstructionEditOverlayMigrationState" NOT NULL DEFAULT 'MIGRATED',
  "kind" "WorkInstructionEditOverlayKind" NOT NULL,
  "xRatio" DECIMAL(10,8) NOT NULL,
  "yRatio" DECIMAL(10,8) NOT NULL,
  "widthRatio" DECIMAL(10,8) NOT NULL,
  "heightRatio" DECIMAL(10,8) NOT NULL,
  "zIndex" INTEGER NOT NULL DEFAULT 0,
  "opacity" DECIMAL(5,4) NOT NULL DEFAULT 1,
  "maskEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maskColor" TEXT,
  "text" TEXT,
  "textStyle" JSONB,
  "editAssetId" TEXT,
  "objectFit" TEXT,
  "shapeKind" "WorkInstructionEditOverlayShapeKind",
  "strokeColor" TEXT,
  "fillColor" TEXT,
  "strokeWidthRatio" DECIMAL(10,8),
  "shapeStartXRatio" DECIMAL(10,8),
  "shapeStartYRatio" DECIMAL(10,8),
  "shapeEndXRatio" DECIMAL(10,8),
  "shapeEndYRatio" DECIMAL(10,8),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionEditOverlay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionEditOverlay_migratedFromStep_check" CHECK ("migratedFromStep" > 0),
  CONSTRAINT "WorkInstructionEditOverlay_sourceStep_check" CHECK ("sourceStep" IS NULL OR "sourceStep" > 0),
  CONSTRAINT "WorkInstructionEditOverlay_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditOverlay_editAssetId_fkey"
    FOREIGN KEY ("editAssetId") REFERENCES "WorkInstructionEditAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionEditOverlay_bbox_check" CHECK (
    "xRatio" >= 0 AND "xRatio" <= 1 AND
    "yRatio" >= 0 AND "yRatio" <= 1 AND
    "widthRatio" > 0 AND "heightRatio" > 0 AND
    "xRatio" + "widthRatio" <= 1 AND "yRatio" + "heightRatio" <= 1
  ),
  CONSTRAINT "WorkInstructionEditOverlay_opacity_check" CHECK ("opacity" >= 0 AND "opacity" <= 1),
  CONSTRAINT "WorkInstructionEditOverlay_mask_check" CHECK (
    "maskEnabled" = false OR ("maskColor" IS NOT NULL AND char_length("maskColor") > 0)
  ),
  CONSTRAINT "WorkInstructionEditOverlay_variant_check" CHECK (
    ("kind" = 'TEXT' AND "text" IS NOT NULL AND "editAssetId" IS NULL AND "shapeKind" IS NULL) OR
    ("kind" = 'IMAGE' AND "editAssetId" IS NOT NULL AND "text" IS NULL AND "shapeKind" IS NULL) OR
    ("kind" = 'SHAPE' AND "shapeKind" IS NOT NULL AND "text" IS NULL AND "editAssetId" IS NULL)
  ),
  CONSTRAINT "WorkInstructionEditOverlay_objectFit_check" CHECK (
    "objectFit" IS NULL OR "objectFit" IN ('contain', 'cover', 'fill')
  ),
  CONSTRAINT "WorkInstructionEditOverlay_strokeWidth_check" CHECK (
    "strokeWidthRatio" IS NULL OR "strokeWidthRatio" > 0
  ),
  CONSTRAINT "WorkInstructionEditOverlay_shapePoints_check" CHECK (
    "shapeKind" IS NULL OR "shapeKind" NOT IN ('LINE', 'ARROW') OR (
      "shapeStartXRatio" IS NOT NULL AND "shapeStartYRatio" IS NOT NULL AND
      "shapeEndXRatio" IS NOT NULL AND "shapeEndYRatio" IS NOT NULL AND
      "shapeStartXRatio" >= 0 AND "shapeStartXRatio" <= 1 AND
      "shapeStartYRatio" >= 0 AND "shapeStartYRatio" <= 1 AND
      "shapeEndXRatio" >= 0 AND "shapeEndXRatio" <= 1 AND
      "shapeEndYRatio" >= 0 AND "shapeEndYRatio" <= 1
    )
  )
);

CREATE TABLE "WorkInstructionSourcePublication" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "rowId" TEXT NOT NULL,
  "latestVersionId" TEXT NOT NULL,
  "publishedVersionId" TEXT NOT NULL,
  "publishedRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkInstructionSourcePublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionSourcePublication_rowId_fkey"
    FOREIGN KEY ("rowId") REFERENCES "WorkInstructionRow"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionSourcePublication_latestVersionId_fkey"
    FOREIGN KEY ("latestVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionSourcePublication_publishedVersionId_fkey"
    FOREIGN KEY ("publishedVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkInstructionSourcePublication_publishedRevisionId_fkey"
    FOREIGN KEY ("publishedRevisionId") REFERENCES "WorkInstructionEditRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkInstructionSourceAssetDeletionAudit" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "assetId" TEXT NOT NULL,
  "sourceVersionId" TEXT NOT NULL,
  "storageKey" VARCHAR(1024) NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "requestedBy" VARCHAR(200) NOT NULL,
  "status" "WorkInstructionSourceAssetDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WorkInstructionSourceAssetDeletionAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkInstructionSourceAssetDeletionAudit_sourceVersionId_fkey"
    FOREIGN KEY ("sourceVersionId") REFERENCES "WorkInstructionSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkInstructionSourceVersion_unique_snapshot"
  ON "WorkInstructionSourceVersion"("rowId", "sourceModified", "contentHash");
CREATE INDEX "WorkInstructionSourceVersion_idx_row_modified"
  ON "WorkInstructionSourceVersion"("rowId", "sourceModified");
CREATE INDEX "WorkInstructionSourceVersion_idx_group"
  ON "WorkInstructionSourceVersion"("partNumber", "shootingTarget", "sourceModified");
CREATE UNIQUE INDEX "WorkInstructionSourceVersionStep_unique_step"
  ON "WorkInstructionSourceVersionStep"("sourceVersionId", "step");
CREATE INDEX "WorkInstructionSourceVersionStep_idx_asset"
  ON "WorkInstructionSourceVersionStep"("imageAssetId");
CREATE UNIQUE INDEX "WorkInstructionEditRevision_unique_number"
  ON "WorkInstructionEditRevision"("sourceVersionId", "revisionNumber");
CREATE UNIQUE INDEX "WorkInstructionEditRevision_unique_head"
  ON "WorkInstructionEditRevision"("sourceVersionId") WHERE "isRevisionHead" = true;
CREATE INDEX "WorkInstructionEditRevision_idx_head"
  ON "WorkInstructionEditRevision"("sourceVersionId", "isRevisionHead");
CREATE INDEX "WorkInstructionEditRevision_idx_status_updated"
  ON "WorkInstructionEditRevision"("status", "updatedAt");
CREATE INDEX "WorkInstructionEditRevision_idx_supersedes"
  ON "WorkInstructionEditRevision"("supersedesRevisionId");
CREATE INDEX "WorkInstructionEditRevision_idx_copied_from"
  ON "WorkInstructionEditRevision"("copiedFromRevisionId");
CREATE UNIQUE INDEX "WorkInstructionEditAsset_storageKey_key"
  ON "WorkInstructionEditAsset"("storageKey");
CREATE INDEX "WorkInstructionEditAsset_idx_status_created"
  ON "WorkInstructionEditAsset"("status", "createdAt");
CREATE INDEX "WorkInstructionEditAsset_idx_status_delete_pending"
  ON "WorkInstructionEditAsset"("status", "deletePendingAt");
CREATE INDEX "WorkInstructionEditAsset_idx_owner_created"
  ON "WorkInstructionEditAsset"("ownerRevisionId", "createdAt");
CREATE INDEX "WorkInstructionEditAsset_idx_origin_source"
  ON "WorkInstructionEditAsset"("originSourceVersionId", "originSourceStep");
CREATE INDEX "WorkInstructionEditOverlay_idx_revision_step_z"
  ON "WorkInstructionEditOverlay"("revisionId", "sourceStep", "zIndex");
CREATE INDEX "WorkInstructionEditOverlay_idx_asset"
  ON "WorkInstructionEditOverlay"("editAssetId");
CREATE INDEX "WorkInstructionEditOverlay_idx_migration_state"
  ON "WorkInstructionEditOverlay"("revisionId", "migrationState");
CREATE UNIQUE INDEX "WorkInstructionSourcePublication_row_key"
  ON "WorkInstructionSourcePublication"("rowId");
CREATE INDEX "WorkInstructionSourcePublication_idx_latest"
  ON "WorkInstructionSourcePublication"("latestVersionId");
CREATE INDEX "WorkInstructionSourcePublication_idx_published"
  ON "WorkInstructionSourcePublication"("publishedVersionId");
CREATE INDEX "WorkInstructionSourcePublication_idx_revision"
  ON "WorkInstructionSourcePublication"("publishedRevisionId");
CREATE INDEX "WorkInstructionSourceAssetDeletionAudit_idx_asset"
  ON "WorkInstructionSourceAssetDeletionAudit"("assetId", "requestedAt");
CREATE INDEX "WorkInstructionSourceAssetDeletionAudit_idx_status"
  ON "WorkInstructionSourceAssetDeletionAudit"("status", "requestedAt");
CREATE INDEX "WorkInstructionSourceAssetDeletionAudit_idx_version"
  ON "WorkInstructionSourceAssetDeletionAudit"("sourceVersionId", "requestedAt");
