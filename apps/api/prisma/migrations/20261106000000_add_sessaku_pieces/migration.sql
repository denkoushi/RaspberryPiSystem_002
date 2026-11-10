-- CreateTable
CREATE TABLE "ProductionScheduleSessakuPieceSet" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "fseiban" TEXT NOT NULL,
    "fhincd" TEXT NOT NULL,
    "fsigencd" TEXT NOT NULL,
    "fkojun" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextPosition" INTEGER NOT NULL DEFAULT 1,
    "plannedQuantity" INTEGER,
    "quantityWarning" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleSessakuPieceSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionScheduleSessakuPiece" (
    "id" TEXT NOT NULL,
    "pieceSetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleSessakuPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PSSPieceSet_seiban_idx" ON "ProductionScheduleSessakuPieceSet"("csvDashboardId", "fseiban");

-- CreateIndex
CREATE UNIQUE INDEX "PSSPieceSet_logical_key" ON "ProductionScheduleSessakuPieceSet"("csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun");

-- CreateIndex
CREATE UNIQUE INDEX "PSSPiece_position_key" ON "ProductionScheduleSessakuPiece"("pieceSetId", "position");

-- AddForeignKey
ALTER TABLE "ProductionScheduleSessakuPieceSet" ADD CONSTRAINT "PSSPieceSet_dashboard_fk" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionScheduleSessakuPiece" ADD CONSTRAINT "PSSPiece_set_fk" FOREIGN KEY ("pieceSetId") REFERENCES "ProductionScheduleSessakuPieceSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionScheduleSessakuPieceSet"
  ADD CONSTRAINT "PSSPieceSet_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "PSSPieceSet_next_positive" CHECK ("nextPosition" > 0),
  ADD CONSTRAINT "PSSPieceSet_quantity_nonnegative" CHECK ("plannedQuantity" IS NULL OR "plannedQuantity" >= 0),
  ADD CONSTRAINT "PSSPieceSet_warning_known" CHECK ("quantityWarning" IS NULL OR "quantityWarning" IN ('COMPLETED_QUANTITY_EXCEEDS_PLAN', 'INVALID_PLANNED_QUANTITY'));
ALTER TABLE "ProductionScheduleSessakuPiece"
  ADD CONSTRAINT "PSSPiece_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "PSSPiece_position_positive" CHECK ("position" > 0),
  ADD CONSTRAINT "PSSPiece_completion_consistent" CHECK ("isCompleted" = ("completedAt" IS NOT NULL));
