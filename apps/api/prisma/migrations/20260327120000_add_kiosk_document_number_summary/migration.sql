-- AlterTable
ALTER TABLE "KioskDocument" ADD COLUMN     "candidateDocumentNumber" TEXT,
ADD COLUMN "confidenceDocumentNumber" DOUBLE PRECISION,
ADD COLUMN "confirmedDocumentNumber" TEXT,
ADD COLUMN "summaryCandidate1" TEXT,
ADD COLUMN "summaryCandidate2" TEXT,
ADD COLUMN "summaryCandidate3" TEXT,
ADD COLUMN "confirmedSummaryText" TEXT;

-- CreateIndex
CREATE INDEX "KioskDocument_confirmedDocumentNumber_idx" ON "KioskDocument"("confirmedDocumentNumber");
