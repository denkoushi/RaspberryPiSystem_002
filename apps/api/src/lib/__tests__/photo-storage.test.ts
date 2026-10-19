import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ list: vi.fn(), delete: vi.fn() }));
vi.mock('../../services/file-storage/file-storage-runtime.js', () => ({
  getFileStorageRuntime: () => ({ store }),
}));

import { PhotoStorage } from '../photo-storage.js';

describe('PhotoStorage.deletePhotosByYear', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lists through the store, preserves filters and counts only original photos', async () => {
    store.list.mockResolvedValueOnce(['photo.jpg', 'photo_thumb.jpg', 'keep.png'])
      .mockResolvedValueOnce(['photo_thumb.jpg', 'keep.jpg']);
    expect(await PhotoStorage.deletePhotosByYear(2024)).toBe(1);
    expect(store.list.mock.calls).toEqual([['photos/2026/01'], ['thumbnails/2026/01']]);
    expect(store.delete.mock.calls).toEqual([
      ['photos/2026/01/photo.jpg', { integrity: true }],
      ['thumbnails/2026/01/photo_thumb.jpg', { integrity: true }],
    ]);
  });

  it('still cleans thumbnails when the original namespace is missing', async () => {
    store.list.mockResolvedValueOnce([]).mockResolvedValueOnce(['photo_thumb.jpg']);
    expect(await PhotoStorage.deletePhotosByYear(2024)).toBe(0);
    expect(store.delete).toHaveBeenCalledExactlyOnceWith('thumbnails/2026/01/photo_thumb.jpg', { integrity: true });
  });

  it('returns zero when both namespaces are missing', async () => {
    store.list.mockResolvedValue([]);
    expect(await PhotoStorage.deletePhotosByYear(2024)).toBe(0);
    expect(store.delete).not.toHaveBeenCalled();
  });
});
