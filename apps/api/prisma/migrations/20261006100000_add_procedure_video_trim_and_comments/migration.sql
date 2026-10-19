ALTER TABLE "ProcedureVideo" ADD COLUMN "trimRequest" JSONB;
ALTER TABLE "ProcedureVideo" ADD COLUMN "trimmedAt" TIMESTAMP(3);
ALTER TABLE "ProcedureVideo" ADD COLUMN "sourceDurationSeconds" DOUBLE PRECISION;
CREATE TABLE "ProcedureVideoComment" (
  "id" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "atSeconds" DOUBLE PRECISION NOT NULL,
  "text" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcedureVideoComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureVideoComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ProcedureVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProcedureVideoComment_videoId_sortOrder_idx" ON "ProcedureVideoComment"("videoId", "sortOrder");
