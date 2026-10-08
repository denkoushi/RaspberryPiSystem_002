CREATE TABLE "ProcedureVideoScene" (
  "id" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startSeconds" DOUBLE PRECISION NOT NULL,
  "endSeconds" DOUBLE PRECISION NOT NULL,
  "posterStorageKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcedureVideoScene_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureVideoScene_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ProcedureVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProcedureVideoScene_videoId_startSeconds_idx" ON "ProcedureVideoScene"("videoId", "startSeconds");
ALTER TABLE "ProcedureVideoLink" ADD COLUMN "sceneId" TEXT;
CREATE INDEX "ProcedureVideoLink_sceneId_idx" ON "ProcedureVideoLink"("sceneId");
ALTER TABLE "ProcedureVideoLink" ADD CONSTRAINT "ProcedureVideoLink_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "ProcedureVideoScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
