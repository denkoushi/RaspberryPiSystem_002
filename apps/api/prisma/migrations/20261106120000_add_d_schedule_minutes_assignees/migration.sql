ALTER TABLE "ProductionScheduleDScheduleMinutes"
ADD COLUMN "assignees" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "assigneesKnown" BOOLEAN NOT NULL DEFAULT false;
