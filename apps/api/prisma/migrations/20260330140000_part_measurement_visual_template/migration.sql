-- CreateTable
CREATE TABLE "PartMeasurementVisualTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "drawingImageRelativePath" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMeasurementVisualTemplate_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PartMeasurementTemplate" ADD COLUMN "visualTemplateId" TEXT;

-- AlterTable
ALTER TABLE "PartMeasurementTemplateItem" ADD COLUMN "displayMarker" TEXT;

-- CreateIndex
CREATE INDEX "PartMeasurementVisualTemplate_isActive_name_idx" ON "PartMeasurementVisualTemplate"("isActive", "name");

-- CreateIndex
CREATE INDEX "PartMeasurementTemplate_visualTemplateId_idx" ON "PartMeasurementTemplate"("visualTemplateId");

-- AddForeignKey
ALTER TABLE "PartMeasurementTemplate" ADD CONSTRAINT "PartMeasurementTemplate_visualTemplateId_fkey" FOREIGN KEY ("visualTemplateId") REFERENCES "PartMeasurementVisualTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
