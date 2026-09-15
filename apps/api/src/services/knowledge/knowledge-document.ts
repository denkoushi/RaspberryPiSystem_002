import type { KnowledgeReport } from '@raspi-system/shared-types';
import { z } from 'zod';

export type KnowledgeDocument = { markdown: string; report: KnowledgeReport };
export type KnowledgeRevision = { revision: string; document: KnowledgeDocument };

export const knowledgeReportSchema: z.ZodType<KnowledgeReport> = z.object({
  formatVersion: z.literal(1), topicId: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1).max(120),
  sections: z.array(z.object({
    sourceId: z.string().uuid(), capturedAt: z.string().datetime(),
    title: z.string().min(1).max(120), category: z.string().max(40), summary: z.string().max(3000), originalText: z.string().max(12_000),
    pdf: z.object({ assetId: z.string().regex(/^[a-f0-9]{64}$/), filename: z.string().min(1).max(200), pageNumber: z.number().int().min(1).max(20), extraction: z.enum(['embedded', 'ocr', 'unreadable']) }).strict().optional(),
    photos: z.array(z.object({ imageId: z.string().regex(/^[a-f0-9]{64}$/), description: z.string().min(1).max(1000) }).strict()).max(4),
  }).strict()).min(1).max(20),
}).strict();

export interface KnowledgeDocumentStorePort {
  read(revision?: string): Promise<KnowledgeRevision | null>;
  /** null means first publication; a stale revision must never overwrite newer knowledge. */
  publish(document: KnowledgeDocument, expectedRevision: string | null): Promise<KnowledgeRevision>;
}

export class KnowledgeRevisionConflict extends Error {
  constructor() { super('Knowledge has a newer revision. Reload and regenerate before publishing.'); }
}
