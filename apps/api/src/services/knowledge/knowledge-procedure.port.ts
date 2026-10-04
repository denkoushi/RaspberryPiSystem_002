import type { KnowledgePendingReview, KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

import type { KnowledgeReviewEmployee } from './knowledge-position-rank.js';

import type { ProcedureContent, ProcedureHeader, TitleParts } from './procedure-content.js';

/** `parts` is null only for topics created before titles had parts. */
export type ProcedureTopicRecord = { procedureId: string; header: ProcedureHeader; parts: TitleParts | null };

/** A topic whose materials changed and whose draft must be rebuilt. */
export type ProcedureBuildJob = { procedureId: string; header: ProcedureHeader; requestedAt: Date };

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
  /** Topics whose title or identifiers contain the query, newest first. */
  searchTopics(query: string, limit: number): Promise<ProcedureTopicRecord[]>;
  claimBuild(token: string): Promise<ProcedureBuildJob | null>;
  /** Clears the request only if no newer material arrived since `requestedAt`. */
  completeBuild(procedureId: string, token: string, requestedAt: Date): Promise<void>;
  failBuild(procedureId: string, token: string, errorCode: string, deferred: boolean): Promise<void>;
  listPublished(): Promise<KnowledgeProcedureSummary[]>;
  getPublished(procedureId: string): Promise<KnowledgeProcedureDocument | null>;
}

export interface KnowledgeProcedureReviewRepositoryPort extends KnowledgeProcedureRepositoryPort {
  submitForApproval(revisionId: string): Promise<void>;
  submitStoppedDraftsForApproval(): Promise<void>;
  listPendingApproval(): Promise<KnowledgePendingReview[]>;
  getForReview(revisionId: string): Promise<KnowledgeProcedureDocument | null>;
  approve(revisionId: string, reviewer: KnowledgeReviewEmployee, actorKey: string, comment?: string): Promise<void>;
  returnRevision(revisionId: string, reviewer: KnowledgeReviewEmployee, actorKey: string, comment: string): Promise<void>;
  reportError(procedureId: string, reporter: KnowledgeReviewEmployee, actorKey: string, comment: string): Promise<void>;
}
