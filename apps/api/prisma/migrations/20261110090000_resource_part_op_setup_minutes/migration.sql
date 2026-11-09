ALTER TABLE "ProductionScheduleGrindingPlanningBoardResourcePartOpMinutes"
ADD COLUMN "setupMinutes" INTEGER;

UPDATE "ProductionScheduleGrindingPlanningBoardResourcePartOpMinutes" AS op
SET "setupMinutes" = part."setupMinutes"
FROM "ProductionScheduleGrindingPlanningBoardResourcePartMinutes" AS part
WHERE op."partMinutesId" = part.id
  AND op."opNo" = (
    SELECT MIN(first_op."opNo")
    FROM "ProductionScheduleGrindingPlanningBoardResourcePartOpMinutes" AS first_op
    WHERE first_op."partMinutesId" = part.id
  );
