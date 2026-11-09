-- Existing imports belong to the D company format.
ALTER TABLE "ProductionScheduleDScheduleMinutesImportRun"
ADD COLUMN "kind" VARCHAR(30) NOT NULL DEFAULT 'D_COMPANY';

DROP INDEX "ProductionScheduleDScheduleMinutesImportRun_gmailMessageId_key";
CREATE UNIQUE INDEX "PSDScheduleRun_message_kind_key"
ON "ProductionScheduleDScheduleMinutesImportRun"("gmailMessageId", "kind");
