-- CreateEnum
CREATE TYPE "PhotoToolHumanLabelQuality" AS ENUM ('GOOD', 'MARGINAL', 'BAD');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "photoToolHumanDisplayName" TEXT,
ADD COLUMN     "photoToolHumanQuality" "PhotoToolHumanLabelQuality",
ADD COLUMN     "photoToolHumanReviewedAt" TIMESTAMP(3),
ADD COLUMN     "photoToolHumanReviewedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Loan_photoToolHumanReviewedByUserId_idx" ON "Loan"("photoToolHumanReviewedByUserId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_photoToolHumanReviewedByUserId_fkey" FOREIGN KEY ("photoToolHumanReviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
