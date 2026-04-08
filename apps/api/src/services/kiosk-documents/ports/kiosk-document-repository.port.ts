import type { KioskDocument, KioskDocumentOcrStatus, KioskDocumentSource, Prisma } from '@prisma/client';

export type KioskDocumentListFilters = {
  query?: string;
  sourceType?: KioskDocumentSource;
  ocrStatus?: KioskDocumentOcrStatus;
  includeCandidateInSearch?: boolean;
  enabledOnly?: boolean;
};

/**
 * 要領書ドキュメントの永続化ポート（DIP）
 */
export interface KioskDocumentRepositoryPort {
  create(data: Prisma.KioskDocumentCreateInput): Promise<KioskDocument>;
  findById(id: string): Promise<KioskDocument | null>;
  findByGmailDedupeKey(key: string): Promise<KioskDocument | null>;
  findByGmailLogicalKey(key: string): Promise<KioskDocument | null>;
  list(filters: KioskDocumentListFilters): Promise<KioskDocument[]>;
  listPendingProcessing(limit: number): Promise<KioskDocument[]>;
  delete(id: string): Promise<void>;
  update(id: string, data: Prisma.KioskDocumentUpdateInput): Promise<KioskDocument>;
  createMetadataHistory(data: Prisma.KioskDocumentMetadataHistoryCreateInput): Promise<void>;
}
