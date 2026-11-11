CREATE TABLE "ProductionScheduleSessakuPieceOpSplit" (
    "id" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "fromOpNo" INTEGER NOT NULL,
    "sourceResourceCd" TEXT NOT NULL,
    "leadingSourceResourceCd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionScheduleSessakuPieceOpSplit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PSSPieceOpSplit_piece_op_key" ON "ProductionScheduleSessakuPieceOpSplit"("pieceId", "fromOpNo");
ALTER TABLE "ProductionScheduleSessakuPieceOpSplit" ADD CONSTRAINT "PSSPieceOpSplit_piece_fk"
    FOREIGN KEY ("pieceId") REFERENCES "ProductionScheduleSessakuPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;
