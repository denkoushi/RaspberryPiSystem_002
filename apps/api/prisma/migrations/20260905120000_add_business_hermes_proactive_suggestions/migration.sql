-- CreateTable
CREATE TABLE "BusinessHermesProactiveSuggestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "eventId" TEXT,
    "status" TEXT NOT NULL,
    "reasonCode" TEXT,
    "message" TEXT,
    "targetKey" TEXT,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessHermesProactiveSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHermesProactiveSuggestion_eventId_key" ON "BusinessHermesProactiveSuggestion"("eventId");
CREATE INDEX "BusinessHermesProactiveSuggestion_createdAt_idx" ON "BusinessHermesProactiveSuggestion"("createdAt");
CREATE INDEX "BusinessHermesProactiveSuggestion_sessionId_createdAt_idx" ON "BusinessHermesProactiveSuggestion"("sessionId", "createdAt");
CREATE INDEX "BusinessHermesProactiveSuggestion_clientDeviceId_createdAt_idx" ON "BusinessHermesProactiveSuggestion"("clientDeviceId", "createdAt");
