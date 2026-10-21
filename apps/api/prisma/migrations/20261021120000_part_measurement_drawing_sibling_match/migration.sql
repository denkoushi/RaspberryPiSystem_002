CREATE TYPE "PartMeasurementDrawingSiblingMatchStatus" AS ENUM ('PENDING', 'MATCHED', 'NO_MATCH');

CREATE TABLE "PartMeasurementDrawingSiblingMatch" (
    "id" TEXT NOT NULL,
    "visualTemplateId" TEXT NOT NULL,
    "drawingImageFingerprint" TEXT NOT NULL,
    "matchVersion" TEXT NOT NULL,
    "status" "PartMeasurementDrawingSiblingMatchStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "siblings" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartMeasurementDrawingSiblingMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PMDrawingSiblingMatch_unique_visual_hash_version" ON "PartMeasurementDrawingSiblingMatch"("visualTemplateId", "drawingImageFingerprint", "matchVersion");
CREATE INDEX "PMDrawingSiblingMatch_idx_pending" ON "PartMeasurementDrawingSiblingMatch"("status", "updatedAt");
ALTER TABLE "PartMeasurementDrawingSiblingMatch" ADD CONSTRAINT "PartMeasurementDrawingSiblingMatch_visualTemplateId_fkey" FOREIGN KEY ("visualTemplateId") REFERENCES "PartMeasurementVisualTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartMeasurementDrawingPlacementRun" ADD COLUMN "processGroup" "PartMeasurementProcessGroup";
DROP INDEX "PMDrawingPlacementRun_unique_visual_hash_versions";
CREATE UNIQUE INDEX "PMDrawingPlacementRun_unique_visual_hash_versions_process" ON "PartMeasurementDrawingPlacementRun"("visualTemplateId", "drawingImageFingerprint", "analysisVersion", "placementVersion", "processGroup");
