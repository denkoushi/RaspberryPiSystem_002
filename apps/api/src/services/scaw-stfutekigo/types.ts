import type { Prisma } from '@prisma/client';

export type ScawStfutekigoEnrichmentStatus = 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS';

export type ScawStfutekigoNormalizedRow = {
  originDepartmentCode: string | null;
  originDepartmentName: string | null;
  quantity: Prisma.Decimal | null;
  remarks: string | null;
  nonconformityContent: string | null;
  correctiveContent1: string | null;
  correctiveContent2: string | null;
  dispositionContent: string | null;
  discoveredOn: Date | null;
  sourceUpdatedOn: Date | null;
  manufacturingOrderNo: string | null;
  sourceSeiban: string | null;
  qaIssueCode: string | null;
  nonconformityNo: string;
  dispositionOn: Date | null;
  drawingNumber: string | null;
  rawPayload: Prisma.JsonObject;
  contentHash: string;
  sourceRowOrdinal: number | null;
};

export type ScawStfutekigoEnrichment = {
  partNumber: string | null;
  partName: string | null;
  machineName: string | null;
  resolvedSeiban: string | null;
  enrichmentStatus: ScawStfutekigoEnrichmentStatus;
  enrichedAt: Date | null;
};

export type ScawStfutekigoNormalizationResult = {
  rows: ScawStfutekigoNormalizedRow[];
  duplicateCount: number;
  warnings: string[];
};

export type ScawStfutekigoSyncResult = {
  ingestRunId: string;
  rowsScanned: number;
  uniqueRows: number;
  duplicateRows: number;
  created: number;
  updated: number;
  reactivated: number;
  disappeared: number;
  resolved: number;
  notFound: number;
  ambiguous: number;
  stagingRowsDeleted: number;
  skippedAsOlder: boolean;
  skippedAsAlreadyApplied: boolean;
};
