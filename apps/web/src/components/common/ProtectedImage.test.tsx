import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { __resetProtectedImageBlobUrlCacheForTests } from '../../hooks/useProtectedImageBlobUrl';

import { ProtectedImage } from './ProtectedImage';

vi.mock('../../api/client', () => ({ api: { get: vi.fn() } }));
const apiGet = vi.mocked(api.get);
const revoke = vi.fn();
let sequence = 0;

beforeEach(() => {
  sequence = 0;
  apiGet.mockReset().mockResolvedValue({ data: new Blob(['image']) });
  revoke.mockReset();
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:image-${sequence++}`), revokeObjectURL: revoke });
});
afterEach(() => {
  __resetProtectedImageBlobUrlCacheForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ProtectedImage', () => {
  it('shares thumbnail paths with and without the API prefix', async () => {
    render(<><ProtectedImage path="/storage/thumbnails/a.jpg" alt="first" /><ProtectedImage path="/api/storage/thumbnails/a.jpg" alt="second" /></>);
    await waitFor(() => expect(screen.getByAltText('first')).toHaveAttribute('src', 'blob:image-0'));
    expect(screen.getByAltText('second')).toHaveAttribute('src', 'blob:image-0');
    expect(apiGet).toHaveBeenCalledExactlyOnceWith('storage/thumbnails/a.jpg', { responseType: 'blob' });
  });

  it('waits for a lazy image to enter the viewport', async () => {
    let notify: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const view = render(<ProtectedImage loading="lazy" path="/storage/thumbnails/lazy.jpg" alt="lazy" className="h-20 w-20 object-cover" />);
    expect(observe).toHaveBeenCalledWith(screen.getByAltText('lazy'));
    expect(apiGet).not.toHaveBeenCalled();
    act(() => notify([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(apiGet).not.toHaveBeenCalled();
    act(() => notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(screen.getByAltText('lazy')).toHaveClass('h-20', 'w-20', 'object-cover');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('loads lazy images immediately without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<ProtectedImage loading="lazy" path="/storage/thumbnails/a.jpg" alt="image" />);
    await waitFor(() => expect(screen.getByAltText('image')).toHaveAttribute('src', 'blob:image-0'));
  });

  it('shows the fallback when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('unavailable'));
    render(<ProtectedImage path="/storage/thumbnails/a.jpg" alt="image" fallback={<span>代替画像</span>} />);
    await waitFor(() => expect(screen.queryByAltText('image')).toBeNull());
    expect(screen.getByText('代替画像')).toBeVisible();
  });

  it('shows the fallback when the blob cannot be displayed', async () => {
    render(<ProtectedImage path="/storage/thumbnails/a.jpg" alt="image" fallback={<span>代替画像</span>} />);
    await waitFor(() => expect(screen.getByAltText('image')).toHaveAttribute('src', 'blob:image-0'));
    fireEvent.error(screen.getByAltText('image'));
    expect(screen.getByText('代替画像')).toBeVisible();
  });

  it('refreshes visualization images every 30 seconds and releases replaced URLs', async () => {
    vi.useFakeTimers();
    const view = render(<ProtectedImage path="/signage/visualization-image/id" refreshIntervalMs={30_000} alt="visualization" fallback={<p data-visualization-fallback>読み込み失敗</p>} />);
    await act(async () => {});
    expect(screen.getByAltText('visualization')).toHaveAttribute('src', 'blob:image-0');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet.mock.calls[1][1]?.params._refresh - apiGet.mock.calls[0][1]?.params._refresh).toBe(30_000);
    expect(apiGet).toHaveBeenLastCalledWith('signage/visualization-image/id', { responseType: 'blob', params: { _refresh: expect.any(Number) } });
    expect(screen.getByAltText('visualization')).toHaveAttribute('src', 'blob:image-1');
    expect(revoke).toHaveBeenCalledWith('blob:image-0');
    apiGet.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText('読み込み失敗')).toHaveAttribute('data-visualization-fallback');
    expect(revoke).toHaveBeenCalledWith('blob:image-1');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByAltText('visualization')).toHaveAttribute('src', 'blob:image-2');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:image-2');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(apiGet).toHaveBeenCalledTimes(4);
  });

  it('passes through existing blob URLs without fetching', () => {
    render(<ProtectedImage path="blob:full-photo" alt="photo" />);
    expect(screen.getByAltText('photo')).toHaveAttribute('src', 'blob:full-photo');
    expect(apiGet).not.toHaveBeenCalled();
  });
});
