-- CreateTable
CREATE TABLE "VisualizationDashboard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataSourceType" TEXT NOT NULL,
    "rendererType" TEXT NOT NULL,
    "dataSourceConfig" JSONB NOT NULL,
    "rendererConfig" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizationDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisualizationDashboard_enabled_idx" ON "VisualizationDashboard"("enabled");

-- CreateIndex
CREATE INDEX "VisualizationDashboard_dataSourceType_idx" ON "VisualizationDashboard"("dataSourceType");

-- CreateIndex
CREATE INDEX "VisualizationDashboard_rendererType_idx" ON "VisualizationDashboard"("rendererType");
