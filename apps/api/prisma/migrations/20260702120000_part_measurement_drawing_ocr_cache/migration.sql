CREATE TYPE "PartMeasurementDrawingOcrStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "PartMeasurementDrawingOcrCache" (
  "id" TEXT NOT NULL,
  "visualTemplateId" TEXT NOT NULL,
  "ocrVersion" TEXT NOT NULL,
  "drawingImageFingerprint" TEXT NOT NULL,
  "status" "PartMeasurementDrawingOcrStatus" NOT NULL DEFAULT 'PENDING',
  "payloadCompressed" BYTEA,
  "payloadEncoding" TEXT,
  "engine" TEXT,
  "imageWidth" INTEGER,
  "imageHeight" INTEGER,
  "tokenCount" INTEGER NOT NULL DEFAULT 0,
  "payloadBytes" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "ocrStartedAt" TIMESTAMP(3),
  "ocrFinishedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartMeasurementDrawingOcrCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PMDrawingOcrCache_unique_visual_version_hash"
  ON "PartMeasurementDrawingOcrCache"("visualTemplateId", "ocrVersion", "drawingImageFingerprint");

CREATE INDEX "PMDrawingOcrCache_idx_visual_status"
  ON "PartMeasurementDrawingOcrCache"("visualTemplateId", "status");

CREATE INDEX "PMDrawingOcrCache_idx_status_updated"
  ON "PartMeasurementDrawingOcrCache"("status", "updatedAt");

CREATE INDEX "PMDrawingOcrCache_idx_claim"
  ON "PartMeasurementDrawingOcrCache"("status", "createdAt");

ALTER TABLE "PartMeasurementDrawingOcrCache"
  ADD CONSTRAINT "PartMeasurementDrawingOcrCache_visualTemplateId_fkey"
  FOREIGN KEY ("visualTemplateId")
  REFERENCES "PartMeasurementVisualTemplate"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
