import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { AssemblyProcedureDraftImportService } from '../assembly-procedure-draft-import.service.js';
import type {
  AssemblyProcedureAssetStoragePort,
  StoredAssemblyProcedureAsset,
} from '../../assembly-procedure-assets/assembly-procedure-asset-storage.port.js';

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

  it('stores the original before document creation and compensates it on failure', async () => {
    process.env.PHOTO_STORAGE_DIR = TEST_STORAGE_DIR;
    const jpeg = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();
    const sourceAsset: StoredAssemblyProcedureAsset = {
      assetId: 'source-1',
      storageKey: 'assembly-procedure-assets/source-1.jpg',
      relativeUrl: '/api/storage/assembly-procedure-assets/source-1.jpg',
      contentType: 'image/jpeg',
      size: jpeg.length,
      sha256: 'a'.repeat(64),
    };
    const storage: AssemblyProcedureAssetStoragePort = {
      initialize: vi.fn(),
      save: vi.fn(async () => sourceAsset),
      read: vi.fn(),
      stat: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const procedureService = {
      create: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as AssemblyProcedureDocumentService;
    const service = new AssemblyProcedureDraftImportService(procedureService, storage);

    await expect(
      service.importDraft({
        name: 'source-preserving-failure',
        buffer: jpeg,
        mimetype: 'image/jpeg',
        filename: 'source.jpg',
      }),
    ).rejects.toThrow('database unavailable');
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(procedureService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAsset: expect.objectContaining({
          storageKey: sourceAsset.storageKey,
          kind: 'SOURCE',
        }),
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith(sourceAsset);
    const imageDir = path.join(TEST_STORAGE_DIR, 'assembly-procedure-images');
    const files = await fs.readdir(imageDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    expect(files).toEqual([]);
  });
});
