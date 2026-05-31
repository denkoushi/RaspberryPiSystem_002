import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';

import { usePartMeasurementDrawingBlobUrl } from './usePartMeasurementDrawingBlobUrl';

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn()
  }
}));

const apiGet = vi.mocked(api.get);

describe('usePartMeasurementDrawingBlobUrl', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-drawing');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    apiGet.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL,
      revokeObjectURL
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fetches with /api/ stripped and responseType blob', async () => {
    apiGet.mockResolvedValue({ data: new Blob(['x']) } as never);

    const { result } = renderHook(() =>
      usePartMeasurementDrawingBlobUrl('/api/storage/part-measurement-drawings/a.png')
    );

    await waitFor(() => expect(result.current.blobUrl).toBe('blob:mock-drawing'));

    expect(apiGet).toHaveBeenCalledWith('storage/part-measurement-drawings/a.png', {
      responseType: 'blob'
    });
  });

  it('clears blobUrl immediately when path changes before next fetch completes', async () => {
    let resolveFirst: ((value: { data: Blob }) => void) | undefined;
    let resolveSecond: ((value: { data: Blob }) => void) | undefined;
    const firstPromise = new Promise<{ data: Blob }>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<{ data: Blob }>((resolve) => {
      resolveSecond = resolve;
    });

    apiGet.mockReturnValueOnce(firstPromise as never).mockReturnValueOnce(secondPromise as never);

    const { result, rerender } = renderHook(
      ({ path }) => usePartMeasurementDrawingBlobUrl(path),
      {
        initialProps: { path: '/api/storage/part-measurement-drawings/old.png' }
      }
    );

    rerender({ path: '/api/storage/part-measurement-drawings/new.png' });

    await waitFor(() => expect(result.current.blobUrl).toBeNull());

    await act(async () => {
      resolveFirst?.({ data: new Blob(['x']) });
      await firstPromise;
    });

    expect(result.current.blobUrl).toBeNull();

    await act(async () => {
      resolveSecond?.({ data: new Blob(['y']) });
      await secondPromise;
    });

    await waitFor(() => expect(result.current.blobUrl).toBe('blob:mock-drawing'));
    expect(apiGet).toHaveBeenLastCalledWith('storage/part-measurement-drawings/new.png', {
      responseType: 'blob'
    });
  });

  it('sets error on fetch failure', async () => {
    apiGet.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() =>
      usePartMeasurementDrawingBlobUrl('/api/storage/part-measurement-drawings/missing.png')
    );

    await waitFor(() => expect(result.current.error).toBe('図面の読み込みに失敗しました'));

    expect(result.current.blobUrl).toBeNull();
  });
});
