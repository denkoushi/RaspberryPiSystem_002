CREATE TYPE "PartMeasurementDrawingDimensionMapStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "PartMeasurementDrawingDimensionMap" (
  "id" TEXT NOT NULL,
  "visualTemplateId" TEXT NOT NULL,
  "analysisVersion" TEXT NOT NULL,
  "drawingImageFingerprint" TEXT NOT NULL,
  "status" "PartMeasurementDrawingDimensionMapStatus" NOT NULL DEFAULT 'PENDING',
  "payloadCompressed" BYTEA,
  "payloadEncoding" TEXT,
  "imageWidth" INTEGER,
  "imageHeight" INTEGER,
  "dimensionCount" INTEGER NOT NULL DEFAULT 0,
  "tileCount" INTEGER NOT NULL DEFAULT 0,
  "tileFailedCount" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartMeasurementDrawingDimensionMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PMDrawingDimMap_unique_visual_version_hash"
  ON "PartMeasurementDrawingDimensionMap"("visualTemplateId", "analysisVersion", "drawingImageFingerprint");

CREATE INDEX "PMDrawingDimMap_idx_visual_status"
  ON "PartMeasurementDrawingDimensionMap"("visualTemplateId", "status");

CREATE INDEX "PMDrawingDimMap_idx_claim"
  ON "PartMeasurementDrawingDimensionMap"("status", "nextAttemptAt", "createdAt");

ALTER TABLE "PartMeasurementDrawingDimensionMap"
  ADD CONSTRAINT "PartMeasurementDrawingDimensionMap_visualTemplateId_fkey"
  FOREIGN KEY ("visualTemplateId")
  REFERENCES "PartMeasurementVisualTemplate"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
