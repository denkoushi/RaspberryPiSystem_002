CREATE TYPE "ProcedureMeetingTranscriptionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "ProcedureMeetingTranscriptionJob" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "status" "ProcedureMeetingTranscriptionStatus" NOT NULL DEFAULT 'QUEUED',
    "audioPath" TEXT,
    "audioBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "resultText" TEXT,
    "errorCode" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureMeetingTranscriptionJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcedureMeetingTranscriptionJob_status_retryAt_createdAt_idx" ON "ProcedureMeetingTranscriptionJob"("status", "retryAt", "createdAt");
CREATE INDEX "ProcedureMeetingTranscriptionJob_createdAt_idx" ON "ProcedureMeetingTranscriptionJob"("createdAt");
