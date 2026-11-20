-- AlterTable
ALTER TABLE "mobile_slip_verify_records" ADD COLUMN "recheckOutcome" "MobileSlipVerifyOutcome",
ADD COLUMN "recheckReason" TEXT,
ADD COLUMN "recheckedAt" TIMESTAMP(3);
