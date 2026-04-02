-- CreateEnum
CREATE TYPE "PhotoToolVlmLabelProvenance" AS ENUM ('UNKNOWN', 'FIRST_PASS_VLM', 'ASSIST_ACTIVE_VLM');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "photoToolVlmLabelProvenance" "PhotoToolVlmLabelProvenance" NOT NULL DEFAULT 'UNKNOWN';
