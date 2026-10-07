export type ProcedureMaterialState = 'unplaced' | 'placed' | 'discarded' | 'all';
export type ProcedureMaterialDto = {
  origin: 'GMAIL' | 'KNOWLEDGE';
  knowledgeRef: { kind: 'source' | 'procedure_step'; sourceId?: string; imageId?: string; procedureId?: string; revisionNumber?: number; stepId?: string } | null;
  id: string; kind: 'TEXT' | 'PHOTO' | 'PDF'; text: string | null;
  storageKey: string | null; sha256: string | null; contentType: string | null; byteSize: number | null;
  originalFileName: string | null; width: number | null; height: number | null;
  subjectHint: string | null; fromEmail: string | null; gmailMessageId: string | null; gmailDedupeKey: string;
  receivedAt: string; documentId: string | null; placedAt: string | null; discardedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type ProcedureMaterialIngestResult = {
  scanned: number; processed: number; saved: number; duplicate: number; skipped: number; retryable: number; deferred: number;
  skippedAttachments: number; errors: string[];
  messages: Array<{
    messageId: string; status: 'saved' | 'duplicate' | 'skipped' | 'retryable'; reason?: string;
    saved: number; duplicate: number; skippedAttachments: number; trashed: boolean; warnings: string[];
  }>;
};

export type ProcedureKnowledgeCandidate = {
  candidateKey: string; kind: 'TEXT' | 'PHOTO'; title: string; summary?: string; preview: string;
  sourceLabel: string; alreadyImported: boolean; imageId?: string;
};
export type ProcedureKnowledgeCandidatesResult = { enabled: boolean; items: ProcedureKnowledgeCandidate[] };
export type ProcedureKnowledgeImportResult = { imported: number; duplicate: number; failed: Array<{ candidateKey: string; reason: string }> };
