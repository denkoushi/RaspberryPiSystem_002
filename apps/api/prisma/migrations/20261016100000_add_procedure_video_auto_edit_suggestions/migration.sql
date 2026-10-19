CREATE TYPE "ProcedureVideoAutoEditStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SKIPPED');
CREATE TYPE "ProcedureVideoAutoEditDecision" AS ENUM ('APPLIED', 'DISMISSED');

CREATE TABLE "ProcedureVideoAutoEditSuggestion" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "status" "ProcedureVideoAutoEditStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "ProcedureVideoAutoEditDecision",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingToken" TEXT,
    "modelRoute" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT NOT NULL,
    "suggestion" JSONB NOT NULL DEFAULT '{}',
    "verification" JSONB,
    "confirmed" JSONB,
    "decidedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcedureVideoAutoEditSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProcedureVideoAutoEditSuggestion_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ProcedureVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProcedureVideoAutoEditSuggestion_videoId_createdAt_idx" ON "ProcedureVideoAutoEditSuggestion"("videoId", "createdAt");
CREATE INDEX "ProcedureVideoAutoEditSuggestion_status_createdAt_idx" ON "ProcedureVideoAutoEditSuggestion"("status", "createdAt");
