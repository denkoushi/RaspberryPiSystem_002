-- AlterTable
ALTER TABLE "CsvDashboard" ADD COLUMN     "gmailSubjectPattern" TEXT;

-- CreateIndex
CREATE INDEX "CsvDashboard_gmailSubjectPattern_idx" ON "CsvDashboard"("gmailSubjectPattern");
