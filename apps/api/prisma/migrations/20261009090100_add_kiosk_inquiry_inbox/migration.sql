CREATE TYPE "KioskInquirySide" AS ENUM ('SENDER', 'RECEIVER');

ALTER TABLE "ClientDevice" ADD COLUMN "inquiryReceiverEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "KioskInquiryReceiverEmployee" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KioskInquiryReceiverEmployee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KioskInquiryThread" (
  "id" TEXT NOT NULL,
  "senderClientDeviceId" TEXT NOT NULL,
  "page" TEXT NOT NULL,
  "receiverUnread" BOOLEAN NOT NULL DEFAULT true,
  "senderUnread" BOOLEAN NOT NULL DEFAULT false,
  "lastMessageAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KioskInquiryThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KioskInquiryMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "side" "KioskInquirySide" NOT NULL,
  "body" TEXT NOT NULL,
  "authorClientDeviceId" TEXT,
  "authorEmployeeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KioskInquiryMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KioskInquiryReceiverEmployee_employeeId_key" ON "KioskInquiryReceiverEmployee"("employeeId");
CREATE INDEX "KioskInquiryThread_receiverUnread_idx" ON "KioskInquiryThread"("receiverUnread");
CREATE INDEX "KioskInquiryThread_senderClientDeviceId_senderUnread_idx" ON "KioskInquiryThread"("senderClientDeviceId", "senderUnread");
CREATE INDEX "KioskInquiryThread_lastMessageAt_idx" ON "KioskInquiryThread"("lastMessageAt");
CREATE INDEX "KioskInquiryMessage_threadId_createdAt_idx" ON "KioskInquiryMessage"("threadId", "createdAt");

ALTER TABLE "KioskInquiryReceiverEmployee" ADD CONSTRAINT "KioskInquiryReceiverEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskInquiryThread" ADD CONSTRAINT "KioskInquiryThread_senderClientDeviceId_fkey" FOREIGN KEY ("senderClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskInquiryMessage" ADD CONSTRAINT "KioskInquiryMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "KioskInquiryThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskInquiryMessage" ADD CONSTRAINT "KioskInquiryMessage_authorClientDeviceId_fkey" FOREIGN KEY ("authorClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KioskInquiryMessage" ADD CONSTRAINT "KioskInquiryMessage_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
