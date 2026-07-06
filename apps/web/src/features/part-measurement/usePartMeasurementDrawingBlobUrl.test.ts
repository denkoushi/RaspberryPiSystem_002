import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';

import {
  __resetPartMeasurementDrawingBlobUrlCacheForTests,
  snapDisplayWidthToDerivativeWidth,
  usePartMeasurementDrawingBlobUrl
} from './usePartMeasurementDrawingBlobUrl';

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
    __resetPartMeasurementDrawingBlobUrlCacheForTests();
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
    __resetPartMeasurementDrawingBlobUrlCacheForTests();
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

  it('appends whitelisted w query when displayWidth is provided', async () => {
    apiGet.mockResolvedValue({ data: new Blob(['x']) } as never);

    const { result } = renderHook(() =>
      usePartMeasurementDrawingBlobUrl('/api/storage/part-measurement-drawings/a.png', {
        displayWidth: 1500
      })
    );

    await waitFor(() => expect(result.current.blobUrl).toBe('blob:mock-drawing'));

    expect(apiGet).toHaveBeenCalledWith('storage/part-measurement-drawings/a.png?w=1920', {
      responseType: 'blob'
    });
  });

  it('snaps display width to derivative whitelist', () => {
    expect(snapDisplayWidthToDerivativeWidth(800)).toBe(1280);
    expect(snapDisplayWidthToDerivativeWidth(1280)).toBe(1280);
    expect(snapDisplayWidthToDerivativeWidth(1500)).toBe(1920);
    expect(snapDisplayWidthToDerivativeWidth(3000)).toBe(2560);
  });

  it('reuses cache on remount so fetch runs only once', async () => {
    apiGet.mockResolvedValue({ data: new Blob(['x']) } as never);
    const path = '/api/storage/part-measurement-drawings/cached.png';

    const { unmount } = renderHook(() => usePartMeasurementDrawingBlobUrl(path));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    unmount();

    const { result } = renderHook(() => usePartMeasurementDrawingBlobUrl(path));

    await waitFor(() => expect(result.current.blobUrl).toBe('blob:mock-drawing'));
    expect(apiGet).toHaveBeenCalledTimes(1);
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

  it('does not cache fetch errors and retries on remount', async () => {
    apiGet
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: new Blob(['x']) } as never);

    const path = '/api/storage/part-measurement-drawings/retry.png';

    const { result, unmount } = renderHook(() => usePartMeasurementDrawingBlobUrl(path));

    await waitFor(() => expect(result.current.error).toBe('図面の読み込みに失敗しました'));
    expect(apiGet).toHaveBeenCalledTimes(1);

    unmount();

    const { result: retryResult } = renderHook(() => usePartMeasurementDrawingBlobUrl(path));

    await waitFor(() => expect(retryResult.current.blobUrl).toBe('blob:mock-drawing'));
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
