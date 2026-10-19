import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { ImageOcrPort } from '../ocr/ports/image-ocr.port.js';

import { KnowledgeAssetStore } from './knowledge-asset-store.js';
import { knowledgeSourceSchema, type KnowledgeSource } from './knowledge-source.js';
import type { PdfPagesPort } from './pdf-pages.port.js';
import { importKnowledgeImage } from './knowledge-image-importer.js';

function pageSourceId(importId: string, page: number): string {
  // RFC 4122 v5: the persisted import UUID is the namespace, page number is the name.
  const bytes = createHash('sha1').update(Buffer.from(importId.replace(/-/g, ''), 'hex')).update(String(page)).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class PdfKnowledgeImporter {
  constructor(private readonly assets: KnowledgeAssetStore, private readonly pdf: PdfPagesPort, private readonly ocr: ImageOcrPort) {}

  async import(input: { importId: string; filename: string; capturedAt: string; bytes: Buffer }, signal?: AbortSignal): Promise<KnowledgeSource[]> {
    z.string().uuid().parse(input.importId);
    z.string().datetime().parse(input.capturedAt);
    z.string().min(1).max(200).parse(input.filename);
    if (input.bytes.length > 20_000_000 || !input.bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('A PDF up to 20 MB is required');
    signal?.throwIfAborted();
    // Retain original bytes on failure. Job integration must persist the content hash as its asset reference.
    const original = await this.assets.save(input.bytes, 'original');
    const sources: KnowledgeSource[] = [];
    for await (const page of this.pdf.extract(input.bytes, signal)) {
      signal?.throwIfAborted();
      if (page.pageNumber !== sources.length + 1 || page.pageNumber > 20) throw new Error('Invalid PDF page sequence');
      const image = await importKnowledgeImage(this.assets, page.jpeg);
      let text = page.text.trim();
      let extraction: 'embedded' | 'ocr' | 'unreadable' = 'embedded';
      if (!text) {
        text = (await this.ocr.runOcrOnImage({ imageBytes: await this.assets.readDisplay(image.id), mimeType: 'image/jpeg' })).text.trim();
        extraction = text ? 'ocr' : 'unreadable';
      }
      signal?.throwIfAborted();
      sources.push(knowledgeSourceSchema.parse({
        id: pageSourceId(input.importId, page.pageNumber), text, capturedAt: input.capturedAt,
        images: [image],
        pdf: { assetId: original.id, filename: input.filename, pageNumber: page.pageNumber, extraction },
      }));
    }
    if (!sources.length) throw new Error('PDF contains no readable pages');
    return sources;
  }
}
