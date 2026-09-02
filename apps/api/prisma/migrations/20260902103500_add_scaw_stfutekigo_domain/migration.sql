-- Additive domain projection for the daily scawSTFUTEKIGO full snapshot.
CREATE TYPE "ScawStfutekigoRevisionType" AS ENUM ('CREATED', 'UPDATED');
CREATE TYPE "ScawStfutekigoEnrichmentStatus" AS ENUM ('RESOLVED', 'NOT_FOUND', 'AMBIGUOUS');

ALTER TABLE "CsvDashboardIngestRun" ADD COLUMN "sourceReceivedAt" TIMESTAMP(3);

CREATE TABLE "ScawStfutekigoCurrent" (
    "id" TEXT NOT NULL,
    "nonconformityNo" VARCHAR(120) NOT NULL,
    "originDepartmentCode" TEXT,
    "originDepartmentName" TEXT,
    "quantity" DECIMAL(18,6),
    "remarks" TEXT,
    "nonconformityContent" TEXT,
    "correctiveContent1" TEXT,
    "correctiveContent2" TEXT,
    "dispositionContent" TEXT,
    "discoveredOn" DATE,
    "sourceUpdatedOn" DATE,
    "manufacturingOrderNo" VARCHAR(64),
    "sourceSeiban" VARCHAR(64),
    "resolvedSeiban" VARCHAR(64),
    "qaIssueCode" VARCHAR(120),
    "dispositionOn" DATE,
    "drawingNumber" TEXT,
    "partNumber" VARCHAR(120),
    "partName" TEXT,
    "machineName" TEXT,
    "rawPayload" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "enrichmentStatus" "ScawStfutekigoEnrichmentStatus" NOT NULL DEFAULT 'NOT_FOUND',
    "enrichedAt" TIMESTAMP(3),
    "isPresentInLatestSnapshot" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenIngestRunId" TEXT,
    "lastEvaluatedIngestRunId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastSnapshotReceivedAt" TIMESTAMP(3),
    "lastAbsentAt" TIMESTAMP(3),
    "sourceRowOrdinal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScawStfutekigoCurrent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScawStfutekigoCurrent_lastSeenIngestRunId_fkey"
      FOREIGN KEY ("lastSeenIngestRunId") REFERENCES "CsvDashboardIngestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ScawStfutekigoCurrent_lastEvaluatedIngestRunId_fkey"
      FOREIGN KEY ("lastEvaluatedIngestRunId") REFERENCES "CsvDashboardIngestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ScawStfutekigoRevision" (
    "id" TEXT NOT NULL,
    "currentId" TEXT NOT NULL,
    "revisionType" "ScawStfutekigoRevisionType" NOT NULL,
    "nonconformityNo" VARCHAR(120) NOT NULL,
    "originDepartmentCode" TEXT,
    "originDepartmentName" TEXT,
    "quantity" DECIMAL(18,6),
    "remarks" TEXT,
    "nonconformityContent" TEXT,
    "correctiveContent1" TEXT,
    "correctiveContent2" TEXT,
    "dispositionContent" TEXT,
    "discoveredOn" DATE,
    "sourceUpdatedOn" DATE,
    "manufacturingOrderNo" VARCHAR(64),
    "sourceSeiban" VARCHAR(64),
    "resolvedSeiban" VARCHAR(64),
    "qaIssueCode" VARCHAR(120),
    "dispositionOn" DATE,
    "drawingNumber" TEXT,
    "partNumber" VARCHAR(120),
    "partName" TEXT,
    "machineName" TEXT,
    "rawPayload" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "enrichmentStatus" "ScawStfutekigoEnrichmentStatus" NOT NULL,
    "enrichedAt" TIMESTAMP(3),
    "sourceIngestRunId" TEXT,
    "sourceRowOrdinal" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScawStfutekigoRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScawStfutekigoRevision_currentId_fkey"
      FOREIGN KEY ("currentId") REFERENCES "ScawStfutekigoCurrent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScawStfutekigoRevision_sourceIngestRunId_fkey"
      FOREIGN KEY ("sourceIngestRunId") REFERENCES "CsvDashboardIngestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScawStfutekigoCurrent_nonconformityNo_key"
  ON "ScawStfutekigoCurrent"("nonconformityNo");
CREATE INDEX "ScawStfutekigoCurrent_part_active_discovered_idx"
  ON "ScawStfutekigoCurrent"("partNumber", "isPresentInLatestSnapshot", "discoveredOn" DESC, "nonconformityNo" DESC);
CREATE UNIQUE INDEX "ScawStfutekigoRevision_source_run_no_key"
  ON "ScawStfutekigoRevision"("sourceIngestRunId", "nonconformityNo");
CREATE INDEX "ScawStfutekigoRevision_no_changed_idx"
  ON "ScawStfutekigoRevision"("nonconformityNo", "observedAt" DESC);
CREATE INDEX "ScawStfutekigoRevision_part_changed_idx"
  ON "ScawStfutekigoRevision"("partNumber", "observedAt" DESC);
