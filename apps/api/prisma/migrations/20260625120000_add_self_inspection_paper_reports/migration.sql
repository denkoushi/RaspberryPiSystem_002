-- CreateEnum
CREATE TYPE "SelfInspectionPaperReportStatus" AS ENUM ('ISSUED', 'OCR_REVIEW', 'IMPORTED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SelfInspectionPaperOcrReviewStatus" AS ENUM ('OCR_REVIEW', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SelfInspectionPaperReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "scheduleRowId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "SelfInspectionPaperReportStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "clientDeviceId" TEXT,
    "plannedQuantity" INTEGER NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionPaperReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionPaperReportPage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "pageCode" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "qrPayload" TEXT NOT NULL,
    "entryIndexFrom" INTEGER,
    "entryIndexTo" INTEGER,
    "markerNoFrom" INTEGER,
    "markerNoTo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionPaperReportPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionPaperOcrReview" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "pageId" TEXT,
    "status" "SelfInspectionPaperOcrReviewStatus" NOT NULL DEFAULT 'OCR_REVIEW',
    "qrPayload" TEXT,
    "imageStoragePath" TEXT,
    "ocrCandidateValues" JSONB NOT NULL,
    "confirmedValues" JSONB,
    "confirmedByActorId" TEXT,
    "confirmedByActorName" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionPaperOcrReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SelfInspectionPaperReport_idx_session_status" ON "SelfInspectionPaperReport"("sessionId", "status");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperReport_idx_schedule_status" ON "SelfInspectionPaperReport"("scheduleRowId", "status");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperReport_idx_issued_at" ON "SelfInspectionPaperReport"("issuedAt");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperReport_idx_template" ON "SelfInspectionPaperReport"("templateId");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperReport_idx_client_device" ON "SelfInspectionPaperReport"("clientDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionPaperReportPage_pageCode_key" ON "SelfInspectionPaperReportPage"("pageCode");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionPaperReportPage_unique_report_page" ON "SelfInspectionPaperReportPage"("reportId", "pageNumber");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperReportPage_idx_report" ON "SelfInspectionPaperReportPage"("reportId");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperOcrReview_idx_report_status" ON "SelfInspectionPaperOcrReview"("reportId", "status");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperOcrReview_idx_page" ON "SelfInspectionPaperOcrReview"("pageId");

-- CreateIndex
CREATE INDEX "SelfInspectionPaperOcrReview_idx_confirmed_at" ON "SelfInspectionPaperOcrReview"("confirmedAt");

-- AddForeignKey
ALTER TABLE "SelfInspectionPaperReport" ADD CONSTRAINT "SelfInspectionPaperReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionPaperReport" ADD CONSTRAINT "SelfInspectionPaperReport_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PartMeasurementTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionPaperReport" ADD CONSTRAINT "SelfInspectionPaperReport_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionPaperReportPage" ADD CONSTRAINT "SelfInspectionPaperReportPage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SelfInspectionPaperReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionPaperOcrReview" ADD CONSTRAINT "SelfInspectionPaperOcrReview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SelfInspectionPaperReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionPaperOcrReview" ADD CONSTRAINT "SelfInspectionPaperOcrReview_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SelfInspectionPaperReportPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
