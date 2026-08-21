-- Assembly procedure overlays and revision metadata.
-- This migration is expand-only: existing document and page rows are not altered.

CREATE TYPE "AssemblyProcedureOverlayElementKind" AS ENUM ('TEXT', 'IMAGE', 'SHAPE');
CREATE TYPE "AssemblyProcedureOverlayShapeKind" AS ENUM ('RECTANGLE', 'ELLIPSE', 'LINE', 'ARROW');
CREATE TYPE "AssemblyProcedureAssetKind" AS ENUM ('SOURCE', 'OVERLAY_IMAGE');

CREATE TABLE "AssemblyProcedureAsset" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "kind" "AssemblyProcedureAssetKind" NOT NULL DEFAULT 'SOURCE',
  "storageKey" TEXT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "contentType" TEXT NOT NULL,
  "originalFileName" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "ownerDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssemblyProcedureAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssemblyProcedureAsset_ownerDocumentId_fkey" FOREIGN KEY ("ownerDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureAsset_byteSize_check" CHECK ("byteSize" > 0),
  CONSTRAINT "AssemblyProcedureAsset_dimensions_check" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0))
);

CREATE TABLE "AssemblyProcedureDocumentRevision" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "documentId" TEXT NOT NULL,
  "revisionRootId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  "supersedesDocumentId" TEXT,
  "isRevisionHead" BOOLEAN NOT NULL DEFAULT true,
  "editVersion" INTEGER NOT NULL DEFAULT 0,
  "sourceAssetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssemblyProcedureDocumentRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssemblyProcedureDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureDocumentRevision_revisionRootId_fkey" FOREIGN KEY ("revisionRootId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureDocumentRevision_supersedesDocumentId_fkey" FOREIGN KEY ("supersedesDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureDocumentRevision_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "AssemblyProcedureAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureDocumentRevision_revisionNumber_check" CHECK ("revisionNumber" >= 1),
  CONSTRAINT "AssemblyProcedureDocumentRevision_editVersion_check" CHECK ("editVersion" >= 0),
  CONSTRAINT "AssemblyProcedureDocumentRevision_head_check" CHECK (("isRevisionHead" = true) OR ("revisionRootId" IS NOT NULL))
);

CREATE TABLE "AssemblyProcedureOverlayElement" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "documentId" TEXT NOT NULL,
  "pageIndex" INTEGER NOT NULL,
  "kind" "AssemblyProcedureOverlayElementKind" NOT NULL,
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
  "assetId" TEXT,
  "objectFit" TEXT,
  "shapeKind" "AssemblyProcedureOverlayShapeKind",
  "strokeColor" TEXT,
  "fillColor" TEXT,
  "strokeWidthRatio" DECIMAL(10,8),
  "shapeStartXRatio" DECIMAL(10,8),
  "shapeStartYRatio" DECIMAL(10,8),
  "shapeEndXRatio" DECIMAL(10,8),
  "shapeEndYRatio" DECIMAL(10,8),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssemblyProcedureOverlayElement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssemblyProcedureOverlayElement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureOverlayElement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AssemblyProcedureAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureOverlayElement_document_page_fkey" FOREIGN KEY ("documentId", "pageIndex") REFERENCES "AssemblyProcedureDocumentPage"("documentId", "pageIndex") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssemblyProcedureOverlayElement_pageIndex_check" CHECK ("pageIndex" >= 0),
  CONSTRAINT "AssemblyProcedureOverlayElement_bbox_check" CHECK ("xRatio" >= 0 AND "xRatio" <= 1 AND "yRatio" >= 0 AND "yRatio" <= 1 AND "widthRatio" > 0 AND "heightRatio" > 0 AND "xRatio" + "widthRatio" <= 1 AND "yRatio" + "heightRatio" <= 1),
  CONSTRAINT "AssemblyProcedureOverlayElement_opacity_check" CHECK ("opacity" >= 0 AND "opacity" <= 1),
  CONSTRAINT "AssemblyProcedureOverlayElement_mask_check" CHECK (("maskEnabled" = false) OR ("maskColor" IS NOT NULL AND char_length("maskColor") > 0)),
  CONSTRAINT "AssemblyProcedureOverlayElement_variant_check" CHECK (("kind" = 'TEXT' AND "text" IS NOT NULL AND "assetId" IS NULL AND "shapeKind" IS NULL) OR ("kind" = 'IMAGE' AND "assetId" IS NOT NULL AND "text" IS NULL AND "shapeKind" IS NULL) OR ("kind" = 'SHAPE' AND "shapeKind" IS NOT NULL AND "text" IS NULL AND "assetId" IS NULL)),
  CONSTRAINT "AssemblyProcedureOverlayElement_object_fit_check" CHECK ("objectFit" IS NULL OR "objectFit" IN ('contain', 'cover', 'fill')),
  CONSTRAINT "AssemblyProcedureOverlayElement_stroke_width_check" CHECK ("strokeWidthRatio" IS NULL OR "strokeWidthRatio" > 0),
  CONSTRAINT "AssemblyProcedureOverlayElement_shape_line_points_check" CHECK (("shapeKind" IS NULL) OR ("shapeKind" NOT IN ('LINE', 'ARROW')) OR ("shapeStartXRatio" IS NOT NULL AND "shapeStartYRatio" IS NOT NULL AND "shapeEndXRatio" IS NOT NULL AND "shapeEndYRatio" IS NOT NULL AND "shapeStartXRatio" >= 0 AND "shapeStartXRatio" <= 1 AND "shapeStartYRatio" >= 0 AND "shapeStartYRatio" <= 1 AND "shapeEndXRatio" >= 0 AND "shapeEndXRatio" <= 1 AND "shapeEndYRatio" >= 0 AND "shapeEndYRatio" <= 1))
);

CREATE UNIQUE INDEX "AssemblyProcedureAsset_storageKey_key" ON "AssemblyProcedureAsset"("storageKey");
CREATE INDEX "AssemblyProcedureAsset_idx_sha256" ON "AssemblyProcedureAsset"("sha256");
CREATE INDEX "AssemblyProcedureAsset_idx_owner_created" ON "AssemblyProcedureAsset"("ownerDocumentId", "createdAt");
CREATE UNIQUE INDEX "AssemblyProcedureDocumentRevision_documentId_key" ON "AssemblyProcedureDocumentRevision"("documentId");
CREATE UNIQUE INDEX "AssemblyProcedureDocumentRevision_unique_revision_number" ON "AssemblyProcedureDocumentRevision"("revisionRootId", "revisionNumber");
CREATE UNIQUE INDEX "AssemblyProcedureDocumentRevision_unique_revision_head" ON "AssemblyProcedureDocumentRevision"("revisionRootId") WHERE "isRevisionHead" = true;
CREATE INDEX "AssemblyProcedureDocumentRevision_idx_revision_head" ON "AssemblyProcedureDocumentRevision"("revisionRootId", "isRevisionHead");
CREATE INDEX "AssemblyProcedureDocumentRevision_idx_supersedes" ON "AssemblyProcedureDocumentRevision"("supersedesDocumentId");
CREATE INDEX "AssemblyProcedureDocumentRevision_idx_source_asset" ON "AssemblyProcedureDocumentRevision"("sourceAssetId");
CREATE INDEX "AssemblyProcedureOverlayElement_idx_document_page_z" ON "AssemblyProcedureOverlayElement"("documentId", "pageIndex", "zIndex");
CREATE INDEX "AssemblyProcedureOverlayElement_idx_asset" ON "AssemblyProcedureOverlayElement"("assetId");
