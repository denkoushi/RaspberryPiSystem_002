-- AlterEnum
CREATE TYPE "PartMeasurementDepthMode" AS ENUM ('MEASURED', 'THROUGH');

-- AlterTable
ALTER TABLE "PartMeasurementTemplateItem"
ADD COLUMN "depthMode" "PartMeasurementDepthMode" NOT NULL DEFAULT 'MEASURED';
