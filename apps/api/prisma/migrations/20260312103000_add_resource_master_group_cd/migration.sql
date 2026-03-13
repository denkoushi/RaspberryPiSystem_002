-- AlterTable
ALTER TABLE "ProductionScheduleResourceMaster"
ADD COLUMN "groupCd" VARCHAR(40);

-- CreateIndex
CREATE INDEX "ProductionScheduleResourceMaster_idx_group_cd"
ON "ProductionScheduleResourceMaster"("groupCd");
