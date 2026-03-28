-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "photoToolDisplayName" TEXT,
ADD COLUMN     "photoToolLabelRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photoToolLabelClaimedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Loan_photoToolLabel_job_idx" ON "Loan"("photoToolLabelRequested", "photoToolDisplayName", "photoToolLabelClaimedAt");
