CREATE TABLE "ProductionScheduleOutsourceNamedTarget" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "key" TEXT NOT NULL,
    "vendorId" VARCHAR(100) NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "ProductionScheduleOutsourceNamedTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionScheduleOutsourceNamedTarget_configId_kind_key_key"
    ON "ProductionScheduleOutsourceNamedTarget"("configId", "kind", "key");
ALTER TABLE "ProductionScheduleOutsourceNamedTarget"
    ADD CONSTRAINT "ProductionScheduleOutsourceNamedTarget_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "ProductionScheduleOutsourceConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
