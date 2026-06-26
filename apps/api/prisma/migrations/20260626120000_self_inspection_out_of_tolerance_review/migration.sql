-- CreateEnum
CREATE TYPE "SelfInspectionMeasurementReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "SelfInspectionMeasurementValue"
ADD COLUMN "reviewStatus" "SelfInspectionMeasurementReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "outOfToleranceAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedByUserId" TEXT,
ADD COLUMN "approvedByUsername" TEXT,
ADD COLUMN "approvalComment" TEXT;

-- CreateIndex
CREATE INDEX "SelfInspectionMeasurementValue_idx_review_status" ON "SelfInspectionMeasurementValue"("reviewStatus");

-- CreateIndex
CREATE INDEX "SelfInspectionMeasurementValue_idx_approved_at" ON "SelfInspectionMeasurementValue"("approvedAt");
