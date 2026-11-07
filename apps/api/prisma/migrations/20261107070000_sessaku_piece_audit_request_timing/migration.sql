ALTER TABLE "ProductionScheduleSessakuPieceAuditLog"
  ADD COLUMN "requestedQuantities" JSONB,
  ADD COLUMN "timing" JSONB;
