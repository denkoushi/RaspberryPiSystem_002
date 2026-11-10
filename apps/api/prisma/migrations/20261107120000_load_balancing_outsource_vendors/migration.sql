CREATE TABLE "ProductionScheduleOutsourceConfig" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "siteKey" VARCHAR(120) NOT NULL,
  "mode" VARCHAR(20) NOT NULL DEFAULT 'process',
  "order" TEXT[] NOT NULL DEFAULT ARRAY['due', 'minutes', 'vendor']::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionScheduleOutsourceConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionScheduleOutsourceConfig_csvDashboardId_siteKey_key"
  ON "ProductionScheduleOutsourceConfig"("csvDashboardId", "siteKey");
CREATE TABLE "ProductionScheduleOutsourceVendor" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "vendorId" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120) NOT NULL CHECK (length(trim("name")) > 0),
  "priority" INTEGER NOT NULL CHECK ("priority" >= 1),
  "monthlyCapacityMinutes" DOUBLE PRECISION CHECK ("monthlyCapacityMinutes" >= 0),
  CONSTRAINT "ProductionScheduleOutsourceVendor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionScheduleOutsourceVendor_configId_fkey" FOREIGN KEY ("configId")
    REFERENCES "ProductionScheduleOutsourceConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionScheduleOutsourceVendor_configId_vendorId_key"
  ON "ProductionScheduleOutsourceVendor"("configId", "vendorId");
CREATE TABLE "ProductionScheduleOutsourceCondition" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "resourceCds" TEXT[] NOT NULL,
  "partPrefix" VARCHAR(200) NOT NULL,
  "partName" VARCHAR(200) NOT NULL,
  "maxMinutes" DOUBLE PRECISION CHECK ("maxMinutes" >= 0),
  CONSTRAINT "ProductionScheduleOutsourceCondition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionScheduleOutsourceCondition_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "ProductionScheduleOutsourceVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionScheduleOutsourceCondition_vendorId_position_key"
  ON "ProductionScheduleOutsourceCondition"("vendorId", "position");
