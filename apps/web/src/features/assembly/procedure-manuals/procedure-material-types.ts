export type ProcedureMaterialState = 'unplaced' | 'placed' | 'discarded' | 'all';
export type ProcedureMaterialDto = {
  id: string; kind: 'TEXT' | 'PHOTO'; text: string | null;
  storageKey: string | null; sha256: string | null; contentType: string | null; byteSize: number | null;
  originalFileName: string | null; width: number | null; height: number | null;
  subjectHint: string | null; fromEmail: string | null; gmailMessageId: string; gmailDedupeKey: string;
  receivedAt: string; documentId: string | null; placedAt: string | null; discardedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type ProcedureMaterialIngestResult = {
  scanned: number; processed: number; saved: number; duplicate: number; skipped: number; retryable: number;
  skippedAttachments: number; errors: string[];
  messages: Array<{
    messageId: string; status: 'saved' | 'duplicate' | 'skipped' | 'retryable'; reason?: string;
    saved: number; duplicate: number; skippedAttachments: number; trashed: boolean; warnings: string[];
  }>;
};
