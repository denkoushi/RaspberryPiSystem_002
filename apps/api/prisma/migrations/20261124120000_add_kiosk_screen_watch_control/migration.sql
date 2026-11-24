ALTER TABLE "KioskScreenWatchSession"
ADD COLUMN "viewerUserId" TEXT,
ADD COLUMN "controlGrantedAt" TIMESTAMP(3);

ALTER TABLE "KioskScreenWatchSession"
ADD CONSTRAINT "KioskScreenWatchSession_viewerUserId_fkey"
FOREIGN KEY ("viewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
