CREATE TYPE "PartMeasurementDrawingPlacementProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'UNPLACED');

CREATE TABLE "PartMeasurementDrawingPlacementRun" (
  "id" TEXT NOT NULL,
  "visualTemplateId" TEXT NOT NULL,
  "drawingImageFingerprint" TEXT NOT NULL,
  "analysisVersion" TEXT NOT NULL,
  "placementVersion" TEXT NOT NULL,
  "sourceVisualTemplateId" TEXT,
  "sourceTemplateId" TEXT,
  "rankingMethod" TEXT NOT NULL,
  "proposalCount" INTEGER NOT NULL DEFAULT 0,
  "unplacedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartMeasurementDrawingPlacementRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartMeasurementDrawingPlacementRun_visualTemplateId_fkey"
    FOREIGN KEY ("visualTemplateId") REFERENCES "PartMeasurementVisualTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PartMeasurementDrawingPlacementRun_sourceVisualTemplateId_fkey"
    FOREIGN KEY ("sourceVisualTemplateId") REFERENCES "PartMeasurementVisualTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PMDrawingPlacementRun_unique_visual_hash_versions"
  ON "PartMeasurementDrawingPlacementRun"("visualTemplateId", "drawingImageFingerprint", "analysisVersion", "placementVersion");

CREATE INDEX "PartMeasurementDrawingPlacementRun_sourceVisualTemplateId_idx"
  ON "PartMeasurementDrawingPlacementRun"("sourceVisualTemplateId");

CREATE TABLE "PartMeasurementDrawingPlacementProposal" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "visualTemplateId" TEXT NOT NULL,
  "sourceItemId" TEXT NOT NULL,
  "status" "PartMeasurementDrawingPlacementProposalStatus" NOT NULL DEFAULT 'PROPOSED',
  "sortOrder" INTEGER NOT NULL,
  "measurementLabel" TEXT NOT NULL,
  "measurementPoint" TEXT,
  "decimalPlaces" INTEGER NOT NULL DEFAULT 6,
  "nominalValue" DECIMAL(18,6) NOT NULL,
  "lowerLimit" DECIMAL(18,6),
  "upperLimit" DECIMAL(18,6),
  "depthMode" "PartMeasurementDepthMode" NOT NULL DEFAULT 'MEASURED',
  "valueKind" "PartMeasurementValueKind" NOT NULL DEFAULT 'NUMERIC',
  "markerXRatio" DECIMAL(10,8),
  "markerYRatio" DECIMAL(10,8),
  "dimension" JSONB,
  "candidates" JSONB NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartMeasurementDrawingPlacementProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartMeasurementDrawingPlacementProposal_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "PartMeasurementDrawingPlacementRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PartMeasurementDrawingPlacementProposal_visualTemplateId_fkey"
    FOREIGN KEY ("visualTemplateId") REFERENCES "PartMeasurementVisualTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PMDrawingPlacementProposal_unique_run_item"
  ON "PartMeasurementDrawingPlacementProposal"("runId", "sourceItemId");

CREATE INDEX "PartMeasurementDrawingPlacementProposal_visualTemplateId_idx"
  ON "PartMeasurementDrawingPlacementProposal"("visualTemplateId");
