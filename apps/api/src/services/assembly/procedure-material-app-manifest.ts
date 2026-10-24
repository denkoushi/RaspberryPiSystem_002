import { z } from 'zod/v3';

import type { GmailMessagePart } from '../backup/gmail-api-client.js';

const optionalText = z.string().nullable().optional().transform((value) => value ?? null);
const manifestSchema = z.object({
  schema_version: z.literal(1),
  source: z.object({
    system: z.literal('sharepoint'), list: z.literal('ProcedureMaterialList'),
    item_id: z.number().int().positive().safe(), modified: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  }),
  id: z.number().int().positive().safe(),
  category: optionalText, location: optionalText, note: optionalText,
  name_id: z.union([z.string(), z.number().int().safe()]).nullable().optional().transform((value) => value == null ? null : String(value)),
  photos: z.array(z.object({
    index: z.number().int().positive().safe(), image: z.string().transform((value) => value.normalize('NFC').trim()).pipe(z.string().min(1)),
  })).min(1),
}).refine((value) => value.id === value.source.item_id, 'id must match source.item_id')
  .refine((value) => new Set(value.photos.map((photo) => photo.index)).size === value.photos.length, 'duplicate photo index')
  .refine((value) => new Set(value.photos.map((photo) => photo.image)).size === value.photos.length, 'duplicate photo filename');

export type ProcedureMaterialAppRef = {
  sourceSystem: string; sourceList: string; itemId: number; modified: string; manifestId: number;
  category: string | null; location: string | null; note: string | null; nameId: string | null; photoIndex: number;
};

/** Validate the entire manifest and every filename before any material is persisted. */
export async function resolveProcedureMaterialAppReferences(parts: GmailMessagePart[], bytes: (part: GmailMessagePart) => Promise<Buffer>): Promise<Map<string, ProcedureMaterialAppRef>> {
  const json = parts.filter((part) => {
    const mime = (part.mimeType ?? '').split(';')[0]!.trim().toLowerCase();
    return part.filename?.trim().toLowerCase().endsWith('.json') || mime === 'application/json' || mime.endsWith('+json');
  });
  if (json.length !== 1) throw new Error(`Exactly one JSON manifest attachment is required; found ${json.length}`);
  const manifest = manifestSchema.parse(JSON.parse((await bytes(json[0]!)).toString('utf8').replace(/^\uFEFF/, '')) as unknown);
  const references = new Map<string, ProcedureMaterialAppRef>();
  for (const photo of manifest.photos) {
    const matches = parts.filter((part) => part !== json[0] && part.filename?.normalize('NFC').trim() === photo.image);
    if (matches.length !== 1) throw new Error(`Referenced image is missing or not unique: ${photo.image}`);
    references.set(photo.image, {
      sourceSystem: manifest.source.system, sourceList: manifest.source.list, itemId: manifest.source.item_id,
      modified: manifest.source.modified, manifestId: manifest.id, category: manifest.category,
      location: manifest.location, note: manifest.note, nameId: manifest.name_id, photoIndex: photo.index,
    });
  }
  return references;
}
