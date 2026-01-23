-- CreateTable
CREATE TABLE "CsvImportSubjectPattern" (
    "id" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvImportSubjectPattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CsvImportSubjectPattern_importType_idx" ON "CsvImportSubjectPattern"("importType");

-- CreateIndex
CREATE INDEX "CsvImportSubjectPattern_importType_enabled_idx" ON "CsvImportSubjectPattern"("importType", "enabled");

-- CreateIndex
CREATE INDEX "CsvImportSubjectPattern_priority_idx" ON "CsvImportSubjectPattern"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "CsvImportSubjectPattern_importType_pattern_key" ON "CsvImportSubjectPattern"("importType", "pattern");
