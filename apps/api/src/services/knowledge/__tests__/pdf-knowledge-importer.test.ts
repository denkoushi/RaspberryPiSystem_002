import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { DurableFileStorePort } from '../../file-storage/durable-file-store.port.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';
import { KnowledgeAssetStore } from '../knowledge-asset-store.js';
import { PdfKnowledgeImporter } from '../pdf-knowledge-importer.js';
import type { PdfPagesPort } from '../pdf-pages.port.js';
import { importKnowledgeNote } from '../knowledge-image-importer.js';

function storage() {
  const files = new Map<string, Buffer>();
  const port = {
    write: vi.fn<DurableFileStorePort['write']>().mockImplementation(async request => {
      if (files.has(request.key)) throw new FileStorageAlreadyExistsError();
      files.set(request.key, request.data);
      return { key: request.key, sha256: createHash('sha256').update(request.data).digest('hex'), size: request.data.length };
    }),
    read: vi.fn<DurableFileStorePort['read']>().mockImplementation(async key => files.get(key)!),
  } as unknown as DurableFileStorePort;
  return { assets: new KnowledgeAssetStore(port), files };
}

const input = { importId: '123e4567-e89b-42d3-a456-426614174000', filename: '準備資料.pdf', capturedAt: '2026-09-15T00:00:00.000Z', bytes: Buffer.from('%PDF-1.7 synthetic-original') };
const photo = () => sharp({ create: { width: 40, height: 60, channels: 3, background: '#fefefe' } }).jpeg().toBuffer();

describe('PDF knowledge intake', () => {
  it('also retains original photographs and deduplicates the same note attachment', async () => {
    const { assets, files } = storage();
    const png = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#123456' } }).png().toBuffer();
    const source = await importKnowledgeNote(assets, { id: input.importId, text: ' ', capturedAt: input.capturedAt, images: [png, png] });
    expect(source.text).toBe(' ');
    expect(source.images).toHaveLength(1);
    expect(files.get(source.images[0]!.originalKey)).toEqual(png);
    expect((await sharp(await assets.readDisplay(source.images[0]!.id)).metadata()).format).toBe('jpeg');
  });
  it('retains original bytes, extracts pages, OCRs scanned pages and preserves page citations on replay', async () => {
    const { assets, files } = storage();
    const jpeg = await photo();
    const pdf: PdfPagesPort = { async *extract() { yield { pageNumber: 1, text: '練習用の板を用意', jpeg }; yield { pageNumber: 2, text: '', jpeg }; } };
    const runOcrOnImage = vi.fn().mockResolvedValue({ text: 'スキャンした注意事項', engine: 'test-ocr' });
    const importer = new PdfKnowledgeImporter(assets, pdf, { runOcrOnImage });
    const sources = await importer.import(input);
    expect(sources.map(source => source.pdf?.pageNumber)).toEqual([1, 2]);
    expect(sources.map(source => source.pdf?.extraction)).toEqual(['embedded', 'ocr']);
    expect(sources[1]?.text).toBe('スキャンした注意事項');
    expect(runOcrOnImage).toHaveBeenCalledTimes(1);
    expect(files.get(`knowledge-assets/${sources[0]!.pdf!.assetId}/original`)).toEqual(input.bytes);
    expect(await importer.import(input)).toEqual(sources);
  });

  it('marks unreadable scans explicitly while retaining the page image', async () => {
    const { assets } = storage(); const jpeg = await photo();
    const sources = await new PdfKnowledgeImporter(assets, { async *extract() { yield { pageNumber: 1, text: '', jpeg }; } }, { runOcrOnImage: async () => ({ text: '', engine: 'test-ocr' }) }).import(input);
    expect(sources[0]?.pdf?.extraction).toBe('unreadable');
    expect(sources[0]?.images).toHaveLength(1);
  });

  it('does not return a partial success after a corrupt later page, but retains the PDF', async () => {
    const { assets, files } = storage(); const jpeg = await photo();
    const importer = new PdfKnowledgeImporter(assets, { async *extract() { yield { pageNumber: 1, text: 'A', jpeg }; throw new Error('corrupt PDF'); } }, { runOcrOnImage: vi.fn() });
    await expect(importer.import(input)).rejects.toThrow('corrupt PDF');
    expect([...files.values()].some(value => value.equals(input.bytes))).toBe(true);
  });

  it('rejects non-PDF and canceled inputs before writing files', async () => {
    const { assets, files } = storage();
    const importer = new PdfKnowledgeImporter(assets, { extract: vi.fn() }, { runOcrOnImage: vi.fn() });
    await expect(importer.import({ ...input, bytes: Buffer.from('not a PDF') })).rejects.toThrow('PDF');
    const controller = new AbortController(); controller.abort();
    await expect(importer.import(input, controller.signal)).rejects.toThrow();
    expect(files.size).toBe(0);
  });
});
