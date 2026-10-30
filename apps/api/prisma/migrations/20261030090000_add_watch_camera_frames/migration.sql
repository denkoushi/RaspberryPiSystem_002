-- CreateEnum
CREATE TYPE "WatchCameraJudgement" AS ENUM ('person', 'unjudged');

-- CreateTable
CREATE TABLE "watch_camera_frames" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "judgement" "WatchCameraJudgement" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_camera_frames_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "watch_camera_frames_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "watch_camera_frames_capturedAt_idx" ON "watch_camera_frames"("capturedAt");
CREATE INDEX "watch_camera_frames_clientDeviceId_capturedAt_idx" ON "watch_camera_frames"("clientDeviceId", "capturedAt");
