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

-- Successful pre-PR1 manual operations retain the raw logical key in parentItemId:
-- row: + base64url(JSON.stringify([fseiban, fhincd, fsigencd, fkojun])).
-- Read the audit, not current PieceSets/CSV: adoption may already have deleted the set.
-- Malformed or non-row: values are skipped one by one so the migration never aborts.
DO $$
DECLARE
  rec RECORD;
  raw TEXT;
  k JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CsvDashboard" WHERE "id" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01') THEN
    RETURN;
  END IF;
  FOR rec IN
    SELECT DISTINCT "parentItemId" AS pid
    FROM "ProductionScheduleSessakuPieceAuditLog"
    WHERE "action" IN ('split', 'merge') AND "outcome" = 'success'
      AND "parentItemId" LIKE 'row:%'
  LOOP
    raw := SUBSTRING(rec.pid FROM 5);
    CONTINUE WHEN raw = '' OR raw !~ '^[A-Za-z0-9_-]+={0,2}$';
    BEGIN
      raw := RTRIM(raw, '=');
      k := CONVERT_FROM(DECODE(
        TRANSLATE(raw, '-_', '+/') || REPEAT('=', (4 - LENGTH(raw) % 4) % 4),
        'base64'), 'UTF8')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
    CONTINUE WHEN jsonb_typeof(k) <> 'array' OR jsonb_array_length(k) <> 4
      OR jsonb_typeof(k->0) <> 'string' OR k->>0 = ''
      OR jsonb_typeof(k->1) <> 'string' OR k->>1 = ''
      OR jsonb_typeof(k->2) <> 'string' OR k->>2 = ''
      OR jsonb_typeof(k->3) <> 'string' OR k->>3 = '';
    INSERT INTO "ProductionScheduleSessakuPieceHistory"
      ("id", "csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun")
    VALUES (gen_random_uuid()::text, '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01', k->>0, k->>1, k->>2, k->>3)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
