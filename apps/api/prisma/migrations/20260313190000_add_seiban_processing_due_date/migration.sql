CREATE TABLE "ProductionScheduleSeibanProcessingDueDate" (
  "id" TEXT NOT NULL,
  "csvDashboardId" TEXT NOT NULL,
  "fseiban" VARCHAR(20) NOT NULL,
  "processingType" VARCHAR(20) NOT NULL,
  "dueDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionScheduleSeibanProcessingDueDate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionScheduleSeibanProcessingDueDate_unique_scope"
  ON "ProductionScheduleSeibanProcessingDueDate"("csvDashboardId", "fseiban", "processingType");

CREATE INDEX "ProductionScheduleSeibanProcessingDueDate_idx_seiban"
  ON "ProductionScheduleSeibanProcessingDueDate"("csvDashboardId", "fseiban");
