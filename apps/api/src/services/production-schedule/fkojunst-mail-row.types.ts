export type FkojunstMailNormalizedRow = {
  sourceRowId: string;
  sourceRowOrdinal?: number | null;
  sourceIngestRunCompletedAt?: Date | null;
  sourceIngestRunStartedAt?: Date | null;
  fkojun: string;
  fkoteicd: string;
  fsezono: string;
  statusCode: string;
  sourceUpdatedAt: Date;
  hasUnparseableDate: boolean;
};
