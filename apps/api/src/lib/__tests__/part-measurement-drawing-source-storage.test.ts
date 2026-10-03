import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    resetFileStorageRuntimesForTests();
    if (originalRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = originalRoot;
    await fs.rm(root, { recursive: true, force: true });
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
