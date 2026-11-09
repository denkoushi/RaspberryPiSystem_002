ALTER TABLE "ProductionScheduleGrindingPlanningBoardResourceCapacity" ADD COLUMN "unitSplitEnabled" BOOLEAN;

CREATE TABLE "ProductionScheduleGrindingPlanningBoardResourcePartOpMinutes" (
  "id" TEXT NOT NULL,
  "partMinutesId" TEXT NOT NULL,
  "opNo" INTEGER NOT NULL CHECK ("opNo" BETWEEN 1 AND 20),
  "minutes" DOUBLE PRECISION NOT NULL CHECK ("minutes" > 0 AND "minutes" <= 100000),
  CONSTRAINT "PSGrindingPlanningOpMinutes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PSGrindingPlanningOpMinutes_part_fk" FOREIGN KEY ("partMinutesId") REFERENCES "ProductionScheduleGrindingPlanningBoardResourcePartMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PSGrindingPlanningOpMinutes_part_op_key" ON "ProductionScheduleGrindingPlanningBoardResourcePartOpMinutes"("partMinutesId", "opNo");

CREATE TABLE "ProductionScheduleSessakuPieceOpCompletion" (
  "id" TEXT NOT NULL,
  "pieceId" TEXT NOT NULL,
  "opNo" INTEGER NOT NULL CHECK ("opNo" BETWEEN 1 AND 20),
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScheduleSessakuPieceOpCompletion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PSSPieceOpCompletion_piece_fk" FOREIGN KEY ("pieceId") REFERENCES "ProductionScheduleSessakuPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PSSPieceOpCompletion_piece_op_key" ON "ProductionScheduleSessakuPieceOpCompletion"("pieceId", "opNo");

CREATE TABLE "ProductionScheduleSessakuPieceHistory" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "fseiban" TEXT NOT NULL,
  "fhincd" TEXT NOT NULL,
  "fsigencd" TEXT NOT NULL,
  "fkojun" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScheduleSessakuPieceHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PSSPieceHistory_dashboard_fk" FOREIGN KEY ("csvDashboardId") REFERENCES "CsvDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PSSPieceHistory_logical_key" ON "ProductionScheduleSessakuPieceHistory"("csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun");
