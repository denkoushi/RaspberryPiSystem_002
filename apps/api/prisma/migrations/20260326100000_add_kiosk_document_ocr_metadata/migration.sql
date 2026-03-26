-- CreateEnum
CREATE TYPE "KioskDocumentOcrStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "KioskDocument"
ADD COLUMN "displayTitle" TEXT,
ADD COLUMN "fileHash" TEXT,
ADD COLUMN "extractedText" TEXT,
ADD COLUMN "ocrStatus" "KioskDocumentOcrStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "ocrEngine" TEXT,
ADD COLUMN "ocrStartedAt" TIMESTAMP(3),
ADD COLUMN "ocrFinishedAt" TIMESTAMP(3),
ADD COLUMN "ocrRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ocrFailureReason" TEXT,
ADD COLUMN "ocrTargetPages" INTEGER,
ADD COLUMN "candidateFhincd" TEXT,
ADD COLUMN "candidateDrawingNumber" TEXT,
ADD COLUMN "candidateProcessName" TEXT,
ADD COLUMN "candidateResourceCd" TEXT,
ADD COLUMN "confidenceFhincd" DOUBLE PRECISION,
ADD COLUMN "confidenceDrawingNumber" DOUBLE PRECISION,
ADD COLUMN "confidenceProcessName" DOUBLE PRECISION,
ADD COLUMN "confidenceResourceCd" DOUBLE PRECISION,
ADD COLUMN "confirmedFhincd" TEXT,
ADD COLUMN "confirmedDrawingNumber" TEXT,
ADD COLUMN "confirmedProcessName" TEXT,
ADD COLUMN "confirmedResourceCd" TEXT,
ADD COLUMN "documentCategory" TEXT;

-- CreateTable
CREATE TABLE "KioskDocumentMetadataHistory" (
  "id" TEXT NOT NULL,
  "kioskDocumentId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "changedFields" TEXT[],
  "previousDisplayTitle" TEXT,
  "nextDisplayTitle" TEXT,
  "previousFhincd" TEXT,
  "nextFhincd" TEXT,
  "previousDrawingNumber" TEXT,
  "nextDrawingNumber" TEXT,
  "previousProcessName" TEXT,
  "nextProcessName" TEXT,
  "previousResourceCd" TEXT,
  "nextResourceCd" TEXT,
  "previousCategory" TEXT,
  "nextCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KioskDocumentMetadataHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskDocument_displayTitle_idx" ON "KioskDocument"("displayTitle");
CREATE INDEX "KioskDocument_ocrStatus_idx" ON "KioskDocument"("ocrStatus");
CREATE INDEX "KioskDocument_fileHash_idx" ON "KioskDocument"("fileHash");
CREATE INDEX "KioskDocument_confirmedFhincd_idx" ON "KioskDocument"("confirmedFhincd");
CREATE INDEX "KioskDocument_confirmedDrawingNumber_idx" ON "KioskDocument"("confirmedDrawingNumber");
CREATE INDEX "KioskDocument_confirmedProcessName_idx" ON "KioskDocument"("confirmedProcessName");
CREATE INDEX "KioskDocument_confirmedResourceCd_idx" ON "KioskDocument"("confirmedResourceCd");
CREATE INDEX "KioskDocumentMetadataHistory_kioskDocumentId_createdAt_idx"
  ON "KioskDocumentMetadataHistory"("kioskDocumentId", "createdAt");
CREATE INDEX "KioskDocumentMetadataHistory_actorUserId_createdAt_idx"
  ON "KioskDocumentMetadataHistory"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "KioskDocumentMetadataHistory"
ADD CONSTRAINT "KioskDocumentMetadataHistory_kioskDocumentId_fkey"
FOREIGN KEY ("kioskDocumentId") REFERENCES "KioskDocument"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
