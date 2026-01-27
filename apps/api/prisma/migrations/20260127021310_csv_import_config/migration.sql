-- CreateEnum
CREATE TYPE "CsvDashboardConfigType" AS ENUM ('DASHBOARD', 'MASTER');

-- CreateEnum
CREATE TYPE "CsvImportStrategy" AS ENUM ('UPSERT', 'REPLACE');

-- AlterTable
ALTER TABLE "CsvDashboard" ADD COLUMN     "allowedManualImport" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowedScheduledImport" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "configType" "CsvDashboardConfigType" NOT NULL DEFAULT 'DASHBOARD',
ADD COLUMN     "importStrategy" "CsvImportStrategy" NOT NULL DEFAULT 'UPSERT',
ADD COLUMN     "importType" TEXT NOT NULL DEFAULT 'csvDashboards';

-- AlterTable
ALTER TABLE "CsvImportSubjectPattern" ADD COLUMN     "dashboardId" TEXT;

-- CreateIndex
CREATE INDEX "CsvDashboard_configType_importType_idx" ON "CsvDashboard"("configType", "importType");

-- CreateIndex
CREATE INDEX "CsvImportSubjectPattern_dashboardId_idx" ON "CsvImportSubjectPattern"("dashboardId");

-- RenameIndex
ALTER INDEX "MeasuringInstrumentLoanEvent_managementNumber_eventAt_action_ke" RENAME TO "MeasuringInstrumentLoanEvent_managementNumber_eventAt_actio_key";
