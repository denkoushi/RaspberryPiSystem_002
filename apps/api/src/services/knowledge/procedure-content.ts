import { z } from 'zod';

import type {
  KnowledgeProcedureDocument, KnowledgeProcedureReviewTier, KnowledgeProcedureRevisionState, KnowledgeProcedureSource,
} from '@raspi-system/shared-types';

// Value domains are mirrored by DB CHECK constraints in migration 20260927100000_add_knowledge_procedures.
export const PROCEDURE_REVIEW_TIERS = ['approval_required', 'auto_publish'] as const satisfies readonly KnowledgeProcedureReviewTier[];
export const PROCEDURE_REVISION_STATES = ['draft', 'pending_approval', 'published', 'returned', 'superseded'] as const satisfies readonly KnowledgeProcedureRevisionState[];
const SOURCE_KINDS = ['note', 'photo', 'pdf_page', 'work_instruction_step', 'kiosk_document_page'] as const satisfies readonly KnowledgeProcedureSource['kind'][];

const text = (max: number) => z.string().trim().min(1).max(max);

const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  ref: text(200),
  label: text(300),
  capturedAt: z.string().datetime().optional(),
  quote: text(2000).optional(),
}).strict();

const stepSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: text(120),
  body: text(4000),
  cautions: z.array(text(1000)).max(10),
  needsReview: z.array(text(1000)).max(10),
  photos: z.array(z.object({ imageId: z.string().regex(/^[a-f0-9]{64}$/), caption: z.string().trim().max(500) }).strict()).max(8),
  // A step without provenance is never shown as knowledge.
  sources: z.array(sourceSchema).min(1).max(20),
}).strict();

/** Stored per revision. Titles and identifiers live on the procedure row; this is only the ordered steps. */
export const procedureContentSchema = z.object({
  formatVersion: z.literal(1),
  steps: z.array(stepSchema).min(1).max(100),
}).strict()
  .refine(value => new Set(value.steps.map(step => step.id)).size === value.steps.length, 'Duplicate step id');

export type ProcedureContent = z.infer<typeof procedureContentSchema>;

export const procedureHeaderSchema = z.object({
  title: text(120),
  category: text(60),
  identifiers: z.object({ partNumber: text(200).optional(), drawingNumber: text(200).optional(), processName: text(100).optional() }).strict(),
  reviewTier: z.enum(PROCEDURE_REVIEW_TIERS),
}).strict();

export type ProcedureHeader = z.infer<typeof procedureHeaderSchema>;

/** Title parts: 〈target〉｜〈workType〉｜〈detail〉. The work type comes from the managed list. */
export const titlePartsSchema = z.object({
  target: text(80),
  workType: text(30),
  detail: text(40).optional(),
}).strict();

export type TitleParts = z.infer<typeof titlePartsSchema>;

export function composeTitle(parts: TitleParts): string {
  return [parts.target, parts.workType, parts.detail].filter(Boolean).join('｜');
}

export function procedureImageIds(document: Pick<KnowledgeProcedureDocument, 'steps'>): Set<string> {
  return new Set(document.steps.flatMap(step => step.photos.map(photo => photo.imageId)));
}
