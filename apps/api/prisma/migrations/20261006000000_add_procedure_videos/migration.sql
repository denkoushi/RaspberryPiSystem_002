CREATE TYPE "ProcedureVideoStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
CREATE TABLE "ProcedureVideo" (
  "id" TEXT NOT NULL, "status" "ProcedureVideoStatus" NOT NULL DEFAULT 'PENDING',
  "title" TEXT NOT NULL, "subjectHint" TEXT, "fromEmail" TEXT, "gmailMessageId" TEXT,
  "gmailDedupeKey" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL,
  "sourceFileName" TEXT NOT NULL, "sourceContentType" TEXT NOT NULL, "sourceByteSize" INTEGER NOT NULL,
  "sourceStorageKey" TEXT, "storageKey" TEXT, "posterStorageKey" TEXT, "sha256" TEXT,
  "byteSize" INTEGER, "durationSeconds" DOUBLE PRECISION, "width" INTEGER, "height" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT, "errorMessage" TEXT,
  "processedAt" TIMESTAMP(3), "discardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcedureVideo_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProcedureVideoLink" (
  "id" TEXT NOT NULL, "videoId" TEXT NOT NULL, "assemblyProcedureDocumentId" TEXT NOT NULL,
  "pageIndex" INTEGER NOT NULL, "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcedureVideoLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureVideoLink_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ProcedureVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProcedureVideoLink_assemblyProcedureDocumentId_fkey" FOREIGN KEY ("assemblyProcedureDocumentId") REFERENCES "AssemblyProcedureDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProcedureVideo_gmailDedupeKey_key" ON "ProcedureVideo"("gmailDedupeKey");
CREATE INDEX "ProcedureVideo_status_updatedAt_idx" ON "ProcedureVideo"("status", "updatedAt");
CREATE INDEX "ProcedureVideo_discardedAt_receivedAt_idx" ON "ProcedureVideo"("discardedAt", "receivedAt");
CREATE UNIQUE INDEX "ProcedureVideoLink_assemblyProcedureDocumentId_pageIndex_so_key" ON "ProcedureVideoLink"("assemblyProcedureDocumentId", "pageIndex", "sortOrder");
CREATE INDEX "ProcedureVideoLink_videoId_idx" ON "ProcedureVideoLink"("videoId");
