import sharp from 'sharp';

import { KnowledgeAssetStore } from './knowledge-asset-store.js';
import { knowledgeSourceSchema, type KnowledgeSource } from './knowledge-source.js';

export async function importKnowledgeImage(assets: KnowledgeAssetStore, bytes: Buffer): Promise<KnowledgeSource['images'][number]> {
  if (bytes.length > 10_000_000) throw new Error('Knowledge image exceeds 10 MB');
  const image = sharp(bytes, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Use a JPEG, PNG or static WebP image');
  const original = await assets.save(bytes, 'original');
  const jpeg = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const display = await assets.save(jpeg, 'display.jpg');
  return { id: display.id, originalKey: original.key, displayKey: display.key };
}

export async function importKnowledgeNote(
  assets: KnowledgeAssetStore,
  input: { id: string; text: string; capturedAt: string; images: Buffer[] },
): Promise<KnowledgeSource> {
  if (input.images.length > 4) throw new Error('A note supports up to four photographs');
  // Validate metadata before any write; the images are checked individually below.
  if (!input.text.trim() && !input.images.length) throw new Error('A note or photograph is required');
  knowledgeSourceSchema.parse({ id: input.id, text: input.text.trim() ? input.text : '（写真のみ）', capturedAt: input.capturedAt, images: [] });
  const images: KnowledgeSource['images'] = [];
  for (const bytes of input.images) {
    const image = await importKnowledgeImage(assets, bytes);
    if (!images.some(existing => existing.id === image.id)) images.push(image);
  }
  return knowledgeSourceSchema.parse({ id: input.id, text: input.text, capturedAt: input.capturedAt, images });
}
