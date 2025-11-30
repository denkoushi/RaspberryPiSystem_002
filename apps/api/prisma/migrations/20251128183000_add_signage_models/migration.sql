-- CreateEnum
CREATE TYPE "SignageContentType" AS ENUM ('TOOLS', 'PDF', 'SPLIT');

-- CreateEnum
CREATE TYPE "SignageDisplayMode" AS ENUM ('SLIDESHOW', 'SINGLE');

-- CreateTable
CREATE TABLE "SignageSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" "SignageContentType" NOT NULL,
    "pdfId" TEXT,
    "dayOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignageSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignagePdf" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "displayMode" "SignageDisplayMode" NOT NULL,
    "slideInterval" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignagePdf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignageEmergency" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "contentType" "SignageContentType",
    "pdfId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignageEmergency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignageSchedule_enabled_idx" ON "SignageSchedule"("enabled");

-- CreateIndex
CREATE INDEX "SignageSchedule_priority_idx" ON "SignageSchedule"("priority");

-- CreateIndex
CREATE INDEX "SignagePdf_enabled_idx" ON "SignagePdf"("enabled");

-- CreateIndex
CREATE INDEX "SignageEmergency_enabled_idx" ON "SignageEmergency"("enabled");

-- CreateIndex
CREATE INDEX "SignageEmergency_expiresAt_idx" ON "SignageEmergency"("expiresAt");

-- AddForeignKey
ALTER TABLE "SignageSchedule" ADD CONSTRAINT "SignageSchedule_pdfId_fkey" FOREIGN KEY ("pdfId") REFERENCES "SignagePdf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignageEmergency" ADD CONSTRAINT "SignageEmergency_pdfId_fkey" FOREIGN KEY ("pdfId") REFERENCES "SignagePdf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

