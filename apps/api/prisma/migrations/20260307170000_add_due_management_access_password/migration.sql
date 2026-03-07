-- CreateTable
CREATE TABLE "ProductionScheduleAccessPasswordConfig" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "dueManagementPasswordHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionScheduleAccessPasswordConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionScheduleAccessPasswordConfig_unique_location"
ON "ProductionScheduleAccessPasswordConfig"("location");
