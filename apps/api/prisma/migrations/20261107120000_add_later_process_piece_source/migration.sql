ALTER TABLE "ProductionScheduleSessakuPiece" ADD COLUMN "sourcePieceId" TEXT;
CREATE INDEX "PSSPiece_source_idx" ON "ProductionScheduleSessakuPiece"("sourcePieceId");
ALTER TABLE "ProductionScheduleSessakuPiece" ADD CONSTRAINT "PSSPiece_source_fk" FOREIGN KEY ("sourcePieceId") REFERENCES "ProductionScheduleSessakuPiece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
