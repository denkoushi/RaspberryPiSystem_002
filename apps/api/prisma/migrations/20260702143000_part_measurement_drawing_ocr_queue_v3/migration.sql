ALTER TABLE "PartMeasurementDrawingOcrCache"
  ADD COLUMN "queuePriority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastQueuedAt" TIMESTAMP(3);

CREATE INDEX "PMDrawingOcrCache_idx_claim_priority"
  ON "PartMeasurementDrawingOcrCache"("status", "queuePriority", "lastQueuedAt", "createdAt");
