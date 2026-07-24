import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { AssemblyProcedureDraftImportService } from '../assembly-procedure-draft-import.service.js';

const TEST_STORAGE_DIR = '/tmp/test-assembly-procedure-draft-import';
const ORIGINAL_PHOTO_STORAGE_DIR = process.env.PHOTO_STORAGE_DIR;

describe('AssemblyProcedureDraftImportService', () => {
  afterEach(async () => {
    await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    if (ORIGINAL_PHOTO_STORAGE_DIR == null) delete process.env.PHOTO_STORAGE_DIR;
    else process.env.PHOTO_STORAGE_DIR = ORIGINAL_PHOTO_STORAGE_DIR;
  });

  it('removes saved images when database creation fails', async () => {
    process.env.PHOTO_STORAGE_DIR = TEST_STORAGE_DIR;
    const jpeg = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg()
      .toBuffer();
    const procedureService = {
      create: vi.fn(async () => {
        throw new Error('database unavailable');
      })
    } as unknown as AssemblyProcedureDocumentService;
    const service = new AssemblyProcedureDraftImportService(procedureService);

    await expect(
      service.importDraft({
        name: 'DB失敗テスト',
        buffer: jpeg,
        mimetype: 'image/jpeg',
        filename: 'db-failure.jpg'
      })
    ).rejects.toThrow('database unavailable');

    const imageDir = path.join(TEST_STORAGE_DIR, 'assembly-procedure-images');
    const files = await fs.readdir(imageDir).catch(() => []);
    expect(files).toEqual([]);
  });
});
