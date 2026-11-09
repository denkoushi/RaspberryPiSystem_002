-- Existing imports belong to the D company format.
ALTER TABLE "ProductionScheduleDScheduleMinutesImportRun"
ADD COLUMN "kind" VARCHAR(30) NOT NULL DEFAULT 'D_COMPANY';

DROP INDEX "ProductionScheduleDScheduleMinutesImportRun_gmailMessageId_key";
CREATE UNIQUE INDEX "PSDScheduleRun_message_kind_key"
ON "ProductionScheduleDScheduleMinutesImportRun"("gmailMessageId", "kind");

CREATE TABLE "ProductionScheduleDScheduleMinutesKindMembership" (
    "id" TEXT NOT NULL,
    "csvDashboardId" TEXT NOT NULL,
    "fseiban" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "lastSourceRunId" TEXT NOT NULL,
    "lastMeetingDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionScheduleDScheduleMinutesKindMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PSDScheduleKindMember_dashboard_seiban_kind_key"
ON "ProductionScheduleDScheduleMinutesKindMembership"("csvDashboardId", "fseiban", "kind");
CREATE INDEX "PSDScheduleKindMember_dashboard_kind_idx"
ON "ProductionScheduleDScheduleMinutesKindMembership"("csvDashboardId", "kind");
ALTER TABLE "ProductionScheduleDScheduleMinutesKindMembership"
ADD CONSTRAINT "PSDScheduleKindMember_run_fkey" FOREIGN KEY ("lastSourceRunId")
REFERENCES "ProductionScheduleDScheduleMinutesImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ProductionScheduleDScheduleMinutesKindMembership"
("id", "csvDashboardId", "fseiban", "kind", "lastSourceRunId", "lastMeetingDate", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, minutes."csvDashboardId", minutes."fseiban",
       run."kind", run."id", run."meetingDate", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ProductionScheduleDScheduleMinutes" AS minutes
JOIN "ProductionScheduleDScheduleMinutesImportRun" AS run ON run."id" = minutes."sourceRunId";
