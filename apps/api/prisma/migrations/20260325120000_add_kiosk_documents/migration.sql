-- CreateEnum
CREATE TYPE "KioskDocumentSource" AS ENUM ('MANUAL', 'GMAIL');

-- CreateTable
CREATE TABLE "KioskDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sourceType" "KioskDocumentSource" NOT NULL,
    "gmailMessageId" TEXT,
    "sourceAttachmentName" TEXT,
    "gmailDedupeKey" TEXT,
    "pageCount" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskDocument_gmailDedupeKey_key" ON "KioskDocument"("gmailDedupeKey");

CREATE INDEX "KioskDocument_enabled_idx" ON "KioskDocument"("enabled");

CREATE INDEX "KioskDocument_title_idx" ON "KioskDocument"("title");

CREATE INDEX "KioskDocument_sourceType_idx" ON "KioskDocument"("sourceType");
