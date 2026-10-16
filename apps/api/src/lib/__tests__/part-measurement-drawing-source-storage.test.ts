import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import {
  getFileStorageRuntime,
  resetFileStorageRuntimesForTests,
} from '../../services/file-storage/file-storage-runtime.js';
import { PartMeasurementDrawingStorage } from '../part-measurement-drawing-storage.js';

describe('PartMeasurementDrawingStorage drawing sources', () => {
  let root: string;
  const originalRoot = process.env.FILE_STORAGE_ROOT;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-drawing-source-'));
    process.env.FILE_STORAGE_ROOT = root;
    resetFileStorageRuntimesForTests();
    await getFileStorageRuntime().store.initialize(['part-measurement-drawings', '.integrity']);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetFileStorageRuntimesForTests();
    if (originalRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = originalRoot;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('generates a missing derivative and reuses it through store stat/read', async () => {
    const source = await sharp({ create: { width: 1600, height: 100, channels: 3, background: 'white' } }).png().toBuffer();
    const store = getFileStorageRuntime().store;
    vi.spyOn(store, 'capacity').mockResolvedValue({ availableBytes: 10_000_000, totalBytes: 10_000_000, reserveBytes: 1 });
    const { relativeUrl: url } = await PartMeasurementDrawingStorage.saveDrawing(source, 'image/png');
    const derivativeKey = `part-measurement-drawings-derivatives/w1280/${path.basename(url)}.webp`;
    await expect(store.stat(derivativeKey)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.read(derivativeKey, { verifyIntegrity: false })).rejects.toMatchObject({ code: 'ENOENT' });
    const write = vi.spyOn(store, 'write');
    const read = vi.spyOn(store, 'read');
    const stat = vi.spyOn(store, 'stat');
    const first = await PartMeasurementDrawingStorage.readDrawingDerivative(url, 1280);
    expect(first.contentType).toBe('image/webp');
    expect((await sharp(first.buffer).metadata()).width).toBe(1280);
    expect(write).toHaveBeenCalledWith({ key: derivativeKey, data: first.buffer, mode: 'replace', integrity: false });
    const second = await PartMeasurementDrawingStorage.readDrawingDerivative(url, 1280);
    expect(second.buffer).toEqual(first.buffer);
    expect(write).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(derivativeKey, { verifyIntegrity: false });
    expect(stat).toHaveBeenCalledWith(derivativeKey);
  });

  it('keeps the source bytes under the sources directory and deletes them', async () => {
    const pdf = Buffer.from('%PDF-1.4 source');
    const { storageKey } = await PartMeasurementDrawingStorage.saveDrawingSource(pdf, 'pdf');

    expect(storageKey).toMatch(/^part-measurement-drawings\/sources\/[0-9a-f-]{36}\.pdf$/);
    expect(await PartMeasurementDrawingStorage.readDrawingSource(storageKey)).toEqual(pdf);

    await PartMeasurementDrawingStorage.deleteDrawingSource(storageKey);
    await expect(PartMeasurementDrawingStorage.readDrawingSource(storageKey)).rejects.toThrow();
  });

  it('uses the tif extension for tiff sources', async () => {
    const { storageKey } = await PartMeasurementDrawingStorage.saveDrawingSource(Buffer.from('II*\0'), 'tiff');
    expect(storageKey).toMatch(/\.tif$/);
  });

  it('rejects keys outside the sources directory', async () => {
    await expect(
      PartMeasurementDrawingStorage.readDrawingSource('part-measurement-drawings/other.jpg')
    ).rejects.toThrow('Invalid drawing source key');
  });

  it('cannot be resolved through the served drawing URL', async () => {
    const { storageKey } = await PartMeasurementDrawingStorage.saveDrawingSource(Buffer.from('%PDF-1.4'), 'pdf');
    await expect(PartMeasurementDrawingStorage.readDrawing(`/api/storage/${storageKey}`)).rejects.toThrow(
      'Invalid drawing path'
    );
  });
});
