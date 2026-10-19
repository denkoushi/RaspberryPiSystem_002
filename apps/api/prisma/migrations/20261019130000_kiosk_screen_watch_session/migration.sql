CREATE TYPE "KioskScreenWatchStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'DENIED', 'ENDED', 'EXPIRED', 'FAILED');

CREATE TABLE "KioskScreenWatchSession" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "viewerEmployeeId" TEXT,
  "viewerClientDeviceId" TEXT NOT NULL,
  "targetClientDeviceId" TEXT NOT NULL,
  "status" "KioskScreenWatchStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  CONSTRAINT "KioskScreenWatchSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KioskScreenWatchSession_threadId_idx" ON "KioskScreenWatchSession"("threadId");
CREATE INDEX "KioskScreenWatchSession_targetClientDeviceId_status_idx" ON "KioskScreenWatchSession"("targetClientDeviceId", "status");
-- Prisma cannot express partial indexes: enforce one live request per target even for concurrent requests.
CREATE UNIQUE INDEX "KioskScreenWatchSession_live_target_key" ON "KioskScreenWatchSession"("targetClientDeviceId") WHERE "status" IN ('REQUESTED', 'ACTIVE');

ALTER TABLE "KioskScreenWatchSession" ADD CONSTRAINT "KioskScreenWatchSession_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "KioskInquiryThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KioskScreenWatchSession" ADD CONSTRAINT "KioskScreenWatchSession_viewerEmployeeId_fkey" FOREIGN KEY ("viewerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KioskScreenWatchSession" ADD CONSTRAINT "KioskScreenWatchSession_viewerClientDeviceId_fkey" FOREIGN KEY ("viewerClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KioskScreenWatchSession" ADD CONSTRAINT "KioskScreenWatchSession_targetClientDeviceId_fkey" FOREIGN KEY ("targetClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
