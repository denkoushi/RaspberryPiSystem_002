ALTER TABLE "ProductionScheduleSessakuPiece" ADD COLUMN "sourcePieceId" TEXT;
CREATE INDEX "PSSPiece_source_idx" ON "ProductionScheduleSessakuPiece"("sourcePieceId");
ALTER TABLE "ProductionScheduleSessakuPiece" ADD CONSTRAINT "PSSPiece_source_fk" FOREIGN KEY ("sourcePieceId") REFERENCES "ProductionScheduleSessakuPiece"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "ProductionScheduleSessakuPieceSet" ADD COLUMN "sourcePieceSetId" TEXT;
ALTER TABLE "ProductionScheduleSessakuPieceSet" ADD CONSTRAINT "PSSPieceSet_source_fk" FOREIGN KEY ("sourcePieceSetId") REFERENCES "ProductionScheduleSessakuPieceSet"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
