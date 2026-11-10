CREATE TYPE "WatchCameraSampleStatus" AS ENUM ('running', 'stopped', 'completed');
CREATE TYPE "WatchCameraSampleLabel" AS ENUM ('ok', 'ng', 'later');

CREATE TABLE "watch_camera_sample_sessions" (
    "id" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "intervalSec" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "maxFrames" INTEGER NOT NULL,
    "status" "WatchCameraSampleStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "lastCapturedAt" TIMESTAMP(3),
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watch_camera_sample_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "watch_camera_sample_sessions_clientDeviceId_fkey" FOREIGN KEY ("clientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "watch_camera_sample_frames" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "fileKey" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "label" "WatchCameraSampleLabel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watch_camera_sample_frames_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "watch_camera_sample_frames_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "watch_camera_sample_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "watch_camera_sample_sessions_clientDeviceId_status_idx" ON "watch_camera_sample_sessions"("clientDeviceId", "status");
CREATE INDEX "watch_camera_sample_frames_sessionId_capturedAt_idx" ON "watch_camera_sample_frames"("sessionId", "capturedAt");
-- Also reject duplicate starts across API processes.
CREATE UNIQUE INDEX "watch_camera_sample_sessions_running_device_key" ON "watch_camera_sample_sessions"("clientDeviceId") WHERE "status" = 'running';
