import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureMaterialThumbnailService } from '../procedure-material-thumbnail.service.js';

describe('procedure material thumbnail conversion', () => {
  afterEach(() => vi.restoreAllMocks());
  it('shrinks to 640px and shares concurrent and repeated conversions', async () => {
    const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: 'white' } }).png().toBuffer();
    const service = new ProcedureMaterialThumbnailService();
    const resize = vi.spyOn(sharp.prototype, 'resize');
    const [first, second] = await Promise.all([service.read(bytes), service.read(bytes)]);
    expect(first).toBe(second); expect(await service.read(bytes)).toBe(first);
    expect(resize).toHaveBeenCalledOnce();
    expect(await sharp(first).metadata()).toMatchObject({ format: 'webp', width: 640, height: 427 });
  });
  it('does not enlarge and applies EXIF orientation', async () => {
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'white' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const thumbnail = await new ProcedureMaterialThumbnailService().read(bytes);
    expect(await sharp(thumbnail).metadata()).toMatchObject({ width: 80, height: 120 });
  });
  it('rejects inputs above the existing 40 MP safety limit', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="4001"><rect width="100%" height="100%" fill="white"/></svg>');
    await expect(new ProcedureMaterialThumbnailService().read(bytes)).rejects.toThrow(/pixel limit/i);
  });
  it('removes failed conversions so the next request can retry', async () => {
    const service = new ProcedureMaterialThumbnailService();
    const buffer = vi.spyOn(sharp.prototype, 'toBuffer');
    for (let attempt = 0; attempt < 2; attempt++) await expect(service.read(Buffer.from('invalid'))).rejects.toThrow();
    expect(buffer).toHaveBeenCalledTimes(2);
  });
  it('bounds retained entries to 128 and evicts the least recently used conversion', async () => {
    const images = await Promise.all(Array.from({ length: 129 }, (_, red) => sharp({ create: { width: 2, height: 3, channels: 3, background: { r: red, g: 0, b: 0 } } }).png().toBuffer()));
    const service = new ProcedureMaterialThumbnailService();
    const resize = vi.spyOn(sharp.prototype, 'resize');
    for (const bytes of images) await service.read(bytes);
    await service.read(images[128]); expect(resize).toHaveBeenCalledTimes(129);
    await service.read(images[0]); expect(resize).toHaveBeenCalledTimes(130);
  });
});

describe('durable material thumbnails', () => {
  const original = `procedure-materials/${'a'.repeat(64)}/original`;
  const key = original.replace('original', 'thumbnail-640.webp');
  async function setup() {
    const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: 'white' } }).png().toBuffer();
    const files = new Map([[original, bytes]]);
    const store = {
      read: vi.fn(async (name: string) => { const data = files.get(name); if (!data) throw new Error('missing'); return data; }),
      write: vi.fn(async ({ key: name, data }: { key: string; data: Buffer }) => { files.set(name, data); })
    };
    return { store, files };
  }
  it('persists once for concurrent requests and reuses the stored thumbnail after a service restart without reading the original', async () => {
    const { store } = await setup();
    const service = new ProcedureMaterialThumbnailService();
    const [first, second] = await Promise.all([service.readStored(original, store as never), service.readStored(original, store as never)]);
    expect(first).toBe(second);
    expect(store.write).toHaveBeenCalledExactlyOnceWith({ key, data: first, mode: 'replace', integrity: true });
    store.read.mockClear();
    expect(await new ProcedureMaterialThumbnailService().readStored(original, store as never)).toEqual(first);
    expect(store.read).toHaveBeenCalledExactlyOnceWith(key, { verifyIntegrity: true });
  });
  it.each(['invalid', 'unreadable'])('rebuilds a %s stored thumbnail', async (mode) => {
    const { store, files } = await setup();
    files.set(key, Buffer.from('broken'));
    if (mode === 'unreadable') store.read.mockRejectedValueOnce(new Error('integrity mismatch'));
    const result = await new ProcedureMaterialThumbnailService().readStored(original, store as never);
    expect(await sharp(result).metadata()).toMatchObject({ format: 'webp', width: 640 });
    expect(store.read).toHaveBeenCalledWith(original, { verifyIntegrity: true });
    expect(files.get(key)).toEqual(result);
  });
  it('returns the generated thumbnail when durable storage is full', async () => {
    const { store } = await setup();
    store.write.mockRejectedValue(new Error('capacity reserve'));
    const result = await new ProcedureMaterialThumbnailService().readStored(original, store as never);
    expect(await sharp(result).metadata()).toMatchObject({ format: 'webp', width: 640 });
  });
});
