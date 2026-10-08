import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureMaterialPhotoCache } from './procedure-material-photo-cache';

describe('procedure material photo cache', () => {
  beforeEach(() => {
    let next = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${next++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  it('shares in-flight requests, reuses released URLs and revokes all URLs on close', async () => {
    const cache = new ProcedureMaterialPhotoCache();
    const load = vi.fn().mockResolvedValue(new Blob(['thumbnail']));
    const first = cache.request('photo', load); const second = cache.request('photo', load);
    expect(await first.promise).toBe(await second.promise); expect(load).toHaveBeenCalledOnce();
    first.release(); second.release();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const again = cache.request('photo', load); expect(await again.promise).toBe('blob:0');
    expect(load).toHaveBeenCalledOnce();
    cache.clear(); again.release(); expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:0');
  });
  it('limits fetches to six and removes a queued request when it leaves the viewport', async () => {
    const cache = new ProcedureMaterialPhotoCache();
    const finish: Array<(blob: Blob) => void> = [];
    const load = vi.fn(() => new Promise<Blob>((resolve) => { finish.push(resolve); }));
    const requests = Array.from({ length: 8 }, (_, index) => cache.request(`${index}`, load));
    const cancelled = requests[6].promise.catch(() => 'cancelled'); requests[6].release();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(6));
    expect(await cancelled).toBe('cancelled');
    finish[0](new Blob(['photo']));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(7));
    for (const resolve of finish.slice(1)) resolve(new Blob(['photo']));
    await Promise.all(requests.filter((_, index) => index !== 6).map((request) => request.promise));
    cache.clear();
  });
  it('bounds retained thumbnails and keeps an evicted URL alive until its mounted card releases it', async () => {
    const cache = new ProcedureMaterialPhotoCache();
    const load = vi.fn().mockResolvedValue(new Blob(['photo']));
    const first = cache.request('first', load); await first.promise;
    for (let index = 0; index < 256; index++) {
      const request = cache.request(`${index}`, load); await request.promise; request.release();
    }
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    first.release(); expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:0');
    const recent = cache.request('255', load); await recent.promise; recent.release();
    expect(load).toHaveBeenCalledTimes(257);
    cache.clear(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(257);
  });
  it('rejects oversized retained totals and does not create URLs for responses arriving after close', async () => {
    const cache = new ProcedureMaterialPhotoCache();
    const large = vi.fn().mockResolvedValue(new Blob([new Uint8Array(17 * 1024 * 1024)]));
    const first = cache.request('first', large); await first.promise; first.release();
    const second = cache.request('second', large); await second.promise; second.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:0');
    let finish!: (blob: Blob) => void;
    const late = cache.request('late', () => new Promise((resolve) => { finish = resolve; }));
    const result = late.promise.catch(() => 'closed');
    await vi.waitFor(() => expect(finish).toBeDefined());
    cache.clear(); finish(new Blob(['photo']));
    expect(await result).toBe('closed'); expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
});
