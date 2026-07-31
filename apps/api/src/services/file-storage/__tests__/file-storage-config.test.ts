import { describe, expect, it } from 'vitest';
import { resolveFileStorageConfig } from '../file-storage-config.js';

describe('resolveFileStorageConfig', () => {
  it('accepts consistent canonical and legacy settings', () => {
    expect(
      resolveFileStorageConfig({
        NODE_ENV: 'production',
        FILE_STORAGE_ROOT: '/app/storage',
        PHOTO_STORAGE_DIR: '/app/storage',
        PDF_STORAGE_DIR: '/app/storage',
        CSV_DASHBOARD_STORAGE_DIR: '/app/storage',
        SIGNAGE_RENDER_DIR: '/app/storage/signage-rendered',
      })
    ).toMatchObject({ root: '/app/storage' });
  });

  it('rejects conflicting production aliases', () => {
    expect(() =>
      resolveFileStorageConfig({
        NODE_ENV: 'production',
        FILE_STORAGE_ROOT: '/app/storage',
        PDF_STORAGE_DIR: '/other/storage',
      })
    ).toThrow('PDF_STORAGE_DIR');
  });

  it('rejects relative roots', () => {
    expect(() =>
      resolveFileStorageConfig({
        NODE_ENV: 'production',
        FILE_STORAGE_ROOT: 'storage',
      })
    ).toThrow('absolute');
  });

  it('does not infer the durable test root from the regenerable signage cache', () => {
    expect(
      resolveFileStorageConfig({
        NODE_ENV: 'test',
        SIGNAGE_RENDER_DIR: '/tmp/signage-render-test',
      })
    ).toMatchObject({ root: '/tmp/test-photo-storage' });
  });
});
