-- CreateIndex
CREATE INDEX "SelfInspectionSession_idx_completed_at_updated_at" ON "SelfInspectionSession"("completedAt", "updatedAt" DESC);
