DROP INDEX "PSGrindingPlanningPair_site_names_key";

ALTER TABLE "ProductionScheduleGrindingPlanningBoardPair"
  DROP CONSTRAINT "PSGrindingPlanningPair_distinct_names_check",
  ADD COLUMN "firstPartCode" VARCHAR(200) NOT NULL,
  ADD COLUMN "secondPartCode" VARCHAR(200) NOT NULL,
  ADD CONSTRAINT "PSGrindingPlanningPair_distinct_codes_check" CHECK ("firstPartCode" <> "secondPartCode");

CREATE UNIQUE INDEX "PSGrindingPlanningPair_site_codes_key"
  ON "ProductionScheduleGrindingPlanningBoardPair"("csvDashboardId", "siteKey", "firstPartCode", "secondPartCode");
