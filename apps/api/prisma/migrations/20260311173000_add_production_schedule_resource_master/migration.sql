-- CreateTable
CREATE TABLE "ProductionScheduleResourceMaster" (
    "id" TEXT NOT NULL,
    "resourceCd" VARCHAR(20) NOT NULL,
    "resourceName" VARCHAR(120) NOT NULL,
    "resourceClassCd" VARCHAR(20) NOT NULL,
    "resourceGroupCd" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleResourceMaster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleResourceMaster_unique_cd_name" ON "ProductionScheduleResourceMaster"("resourceCd", "resourceName");

-- CreateIndex
CREATE INDEX "ProductionScheduleResourceMaster_idx_cd" ON "ProductionScheduleResourceMaster"("resourceCd");
