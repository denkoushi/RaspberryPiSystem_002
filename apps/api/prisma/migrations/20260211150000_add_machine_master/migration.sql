CREATE TABLE "Machine" (
  "id" TEXT NOT NULL,
  "equipmentManagementNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT,
  "classification" TEXT,
  "operatingStatus" TEXT,
  "ncManual" TEXT,
  "maker" TEXT,
  "processClassification" TEXT,
  "coolant" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Machine_equipmentManagementNumber_key" ON "Machine"("equipmentManagementNumber");
CREATE INDEX "Machine_operatingStatus_idx" ON "Machine"("operatingStatus");
CREATE INDEX "Machine_classification_idx" ON "Machine"("classification");
