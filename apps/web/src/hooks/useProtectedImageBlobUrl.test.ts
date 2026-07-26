import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';

import {
  PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES,
  __protectedImageBlobCacheSizeForTests,
  __resetProtectedImageBlobUrlCacheForTests,
  useProtectedImageBlobUrl
} from './useProtectedImageBlobUrl';

vi.mock('../api/client', () => ({
  api: { get: vi.fn() }
}));

const apiGet = vi.mocked(api.get);

describe('useProtectedImageBlobUrl', () => {
  let blobSequence = 0;
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    blobSequence = 0;
    apiGet.mockReset();
    revokeObjectURL.mockReset();
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL: vi.fn(() => `blob:assembly-${blobSequence++}`),
      revokeObjectURL
    });
    __resetProtectedImageBlobUrlCacheForTests();
  });

  afterEach(() => {
    __resetProtectedImageBlobUrlCacheForTests();
    vi.unstubAllGlobals();
  });

  it('deduplicates concurrent fetches and reuses one Blob URL', async () => {
    let resolveRequest: ((value: { data: Blob }) => void) | null = null;
    apiGet.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve as (value: { data: Blob }) => void;
      }) as never
    );
    const first = renderHook(() => useProtectedImageBlobUrl('/api/storage/a.png'));
    const second = renderHook(() => useProtectedImageBlobUrl('/api/storage/a.png'));
    expect(apiGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRequest?.({ data: new Blob(['a']) });
    });
    await waitFor(() => expect(first.result.current.blobUrl).toBe('blob:assembly-0'));
    expect(second.result.current.blobUrl).toBe('blob:assembly-0');
  });

  it('clears the old image on path change and evicts unreferenced LRU entries above 12', async () => {
    apiGet.mockImplementation(async () => ({ data: new Blob(['x']) }) as never);
    const hook = renderHook(
      ({ path }) => useProtectedImageBlobUrl(path),
      { initialProps: { path: '/api/storage/old.png' } }
    );
    await waitFor(() => expect(hook.result.current.blobUrl).not.toBeNull());
    hook.rerender({ path: '/api/storage/new.png' });
    expect(hook.result.current.blobUrl).toBeNull();
    await waitFor(() => expect(hook.result.current.blobUrl).toBe('blob:assembly-1'));
    hook.unmount();

    for (let index = 0; index < PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 3; index += 1) {
      const rendered = renderHook(() =>
        useProtectedImageBlobUrl(`/api/storage/cache-${index}.png`)
      );
      await waitFor(() => expect(rendered.result.current.blobUrl).not.toBeNull());
      rendered.unmount();
    }
    expect(__protectedImageBlobCacheSizeForTests()).toBe(
      PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES
    );
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});
