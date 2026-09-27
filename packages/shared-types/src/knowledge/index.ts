/** Trusted structured content. HTML and remote image URLs are never model output fields. */
export interface KnowledgeReport {
  formatVersion: 1;
  topicId: string;
  title: string;
  sections: {
    sourceId: string;
    capturedAt: string;
    title: string;
    category: string;
    summary: string;
    originalText: string;
    pdf?: { assetId: string; filename: string; pageNumber: number; extraction: 'embedded' | 'ocr' | 'unreadable' };
    photos: { imageId: string; description: string }[];
  }[];
}

/** Quality-critical topics need an approval before publication; general knowledge publishes directly. */
export type KnowledgeProcedureReviewTier = 'approval_required' | 'auto_publish';
export type KnowledgeProcedureRevisionState = 'draft' | 'pending_approval' | 'published' | 'returned' | 'superseded';

/** Where a step came from. `label` is display text built by code from trusted metadata, never a URL. */
export interface KnowledgeProcedureSource {
  kind: 'note' | 'photo' | 'pdf_page' | 'work_instruction_step' | 'kiosk_document_page';
  ref: string;
  label: string;
  capturedAt?: string;
  quote?: string;
}

export interface KnowledgeProcedureStep {
  id: string;
  title: string;
  body: string;
  cautions: string[];
  /** Conflicts or gaps between materials that the system did not resolve. */
  needsReview: string[];
  photos: { imageId: string; caption: string }[];
  sources: KnowledgeProcedureSource[];
}

/** One procedure revision, rendered by a fixed template. */
export interface KnowledgeProcedureDocument {
  formatVersion: 1;
  procedureId: string;
  revisionId: string;
  revisionNumber: number;
  title: string;
  category: string;
  identifiers: { partNumber?: string; drawingNumber?: string; processName?: string };
  reviewTier: KnowledgeProcedureReviewTier;
  state: KnowledgeProcedureRevisionState;
  createdAt: string;
  steps: KnowledgeProcedureStep[];
}

export interface KnowledgeProcedureSummary {
  procedureId: string;
  title: string;
  category: string;
  identifiers: KnowledgeProcedureDocument['identifiers'];
  reviewTier: KnowledgeProcedureReviewTier;
  revisionNumber: number;
  publishedAt: string;
}
