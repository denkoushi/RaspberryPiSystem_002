CREATE TYPE "KioskInquiryKind" AS ENUM ('INQUIRY', 'SYSTEM_NOTICE');
ALTER TYPE "KioskInquirySide" ADD VALUE 'SYSTEM';
ALTER TABLE "ClientDevice" ADD COLUMN "systemNoticeReceiverEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KioskInquiryThread"
  ALTER COLUMN "senderClientDeviceId" DROP NOT NULL,
  ADD COLUMN "kind" "KioskInquiryKind" NOT NULL DEFAULT 'INQUIRY',
  ADD COLUMN "noticeKey" TEXT,
  ADD COLUMN "noticeTitle" TEXT,
  ADD COLUMN "noticeResolvedAt" TIMESTAMP(3);
CREATE INDEX "KioskInquiryThread_kind_noticeKey_idx" ON "KioskInquiryThread"("kind", "noticeKey");
-- Prisma cannot express a partial unique index. Keep this invariant in the database.
CREATE UNIQUE INDEX "KioskInquiryThread_unresolved_notice_key"
  ON "KioskInquiryThread"("noticeKey")
  WHERE "kind" = 'SYSTEM_NOTICE' AND "noticeResolvedAt" IS NULL;
