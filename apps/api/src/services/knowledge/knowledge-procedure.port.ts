import type { KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

import type { ProcedureContent, ProcedureHeader } from './procedure-content.js';

export type ProcedureTopicRecord = { procedureId: string; header: ProcedureHeader };

export type NewProcedureRevision = {
  /** Omit to create a new procedure topic. */
  procedureId?: string;
  header: ProcedureHeader;
  content: ProcedureContent;
  createdByKey: string;
};

export interface KnowledgeProcedureRepositoryPort {
  /** Stores a draft revision; the header of an existing procedure is updated to the latest draft's header. */
  createDraft(input: NewProcedureRevision): Promise<{ procedureId: string; revisionId: string; revisionNumber: number }>;
  /**
   * Publishes a draft of an auto_publish procedure and supersedes the previous publication.
   * approval_required procedures are published only through the approval flow (milestone 3).
   */
  publishAutomatic(revisionId: string): Promise<void>;
  /** Every topic, published or not, for assigning new materials. */
  listTopics(): Promise<ProcedureTopicRecord[]>;
  listPublished(): Promise<KnowledgeProcedureSummary[]>;
  getPublished(procedureId: string): Promise<KnowledgeProcedureDocument | null>;
}
