import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock('../../services/file-storage/file-storage-runtime.js', () => ({
  getFileStorageRuntime: () => ({ store }),
}));

import { PhotoStorage } from '../photo-storage.js';

describe('PhotoStorage.deletePhoto', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes original and thumbnail with integrity tracking', async () => {
    await PhotoStorage.deletePhoto('/api/storage/photos/2025/11/photo.jpg');
    expect(store.delete.mock.calls).toEqual([
      ['photos/2025/11/photo.jpg', { integrity: true }],
      ['thumbnails/2025/11/photo_thumb.jpg', { integrity: true }],
    ]);
  });

  it('uses an injected store', async () => {
    const injected = { delete: vi.fn() };
    await PhotoStorage.deletePhoto('/api/storage/photos/2025/11/photo.jpg', injected);
    expect(injected.delete).toHaveBeenCalledTimes(2);
    expect(store.delete).not.toHaveBeenCalled();
  });
});
