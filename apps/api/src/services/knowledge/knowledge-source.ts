import { z } from 'zod';

// The legacy id remains the durable publication/lease key for existing knowledge data.
export const KNOWLEDGE_TOPIC = { id: 'metal-painting-practice', title: 'ナレッジ' } as const;
export const PILOT_TOPIC = KNOWLEDGE_TOPIC;

export const knowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(12_000),
  capturedAt: z.string().datetime(),
  pdf: z.object({
    assetId: z.string().regex(/^[a-f0-9]{64}$/), filename: z.string().min(1).max(200),
    pageNumber: z.number().int().min(1).max(20), extraction: z.enum(['embedded', 'ocr', 'unreadable']),
  }).strict().optional(),
  images: z.array(z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    originalKey: z.string().regex(/^knowledge-assets\/[a-f0-9]{64}\/original$/),
    displayKey: z.string().regex(/^knowledge-assets\/[a-f0-9]{64}\/display\.jpg$/),
  }).strict()).max(4),
}).strict()
  .refine(value => value.text.trim().length > 0 || value.images.length > 0, 'A note or photo is required')
  .refine(value => new Set(value.images.map(image => image.id)).size === value.images.length, 'Duplicate photo references');

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export const organizedNoteSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(3000),
  category: z.enum(['申込み', '実技準備', '学科準備', 'その他']),
  // Original quotations are verified separately; generated statements are never certified as originals.
  quotes: z.array(z.string().min(1).max(2000)).max(8),
  photos: z.array(z.object({ id: z.string(), description: z.string().min(1).max(1000) }).strict()).max(4),
}).strict();

export type OrganizedNote = z.infer<typeof organizedNoteSchema>;
export type ReadyKnowledgeSource = { source: KnowledgeSource; organized: OrganizedNote };

export function validateOrganizedNote(raw: unknown, source: KnowledgeSource): OrganizedNote {
  const note = organizedNoteSchema.parse(raw);
  if (note.quotes.some(quote => !source.text.includes(quote))) throw new Error('Unknown original quotation');
  const ids = new Set(source.images.map(image => image.id));
  if (note.photos.length !== ids.size || new Set(note.photos.map(photo => photo.id)).size !== ids.size
    || note.photos.some(photo => !ids.has(photo.id))) throw new Error('Photo references do not match original sources');
  return note;
}
