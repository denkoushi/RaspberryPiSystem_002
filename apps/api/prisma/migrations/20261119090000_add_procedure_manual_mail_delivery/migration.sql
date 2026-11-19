-- CreateTable
CREATE TABLE "ProcedureManualMailDelivery" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "clientDeviceName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "recipient" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "pdfSha256" CHAR(64) NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "pdfByteSize" INTEGER NOT NULL,

    CONSTRAINT "ProcedureManualMailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureManualMailDelivery_gmailMessageId_key" ON "ProcedureManualMailDelivery"("gmailMessageId");

-- CreateIndex
CREATE INDEX "ProcedureManualMailDelivery_documentId_sentAt_idx" ON "ProcedureManualMailDelivery"("documentId", "sentAt");

