import { describe, expect, it, vi } from 'vitest';
import { VisualizationImageCache } from './visualization-image-cache.js';

describe('VisualizationImageCache', () => {
  it('returns a cached image within the TTL and re-renders at expiry', async () => {
    let now = 0;
    const cache = new VisualizationImageCache(() => now);
    const first = Buffer.from('first');
    const second = Buffer.from('second');
    const render = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect(await cache.get('dashboard', render)).toBe(first);
    now = 29_999;
    expect(await cache.get('dashboard', render)).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
    now = 30_000;
    expect(await cache.get('dashboard', render)).toBe(second);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('shares in-flight renders for the same dashboard', async () => {
    const cache = new VisualizationImageCache();
    let resolve!: (buffer: Buffer) => void;
    const render = vi.fn(() => new Promise<Buffer>((done) => { resolve = done; }));
    const first = cache.get('dashboard', render);
    const second = cache.get('dashboard', render);
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
    const buffer = Buffer.from('image');
    resolve(buffer);
    expect(await first).toBe(buffer);
    expect(await second).toBe(buffer);
  });

  it('evicts the oldest entry when more than 50 images are cached', async () => {
    const cache = new VisualizationImageCache();
    const render = vi.fn(async () => Buffer.from('image'));
    for (let i = 0; i < 51; i++) await cache.get(String(i), render);
    await cache.get('1', render);
    expect(render).toHaveBeenCalledTimes(51);
    await cache.get('0', render);
    expect(render).toHaveBeenCalledTimes(52);
  });

  it('does not cache a failed render and allows a retry', async () => {
    const cache = new VisualizationImageCache();
    const buffer = Buffer.from('image');
    const render = vi.fn().mockRejectedValueOnce(new Error('render failed')).mockResolvedValueOnce(buffer);
    const first = cache.get('dashboard', render);
    const second = cache.get('dashboard', render);
    await expect(first).rejects.toThrow('render failed');
    await expect(second).rejects.toThrow('render failed');
    expect(await cache.get('dashboard', render)).toBe(buffer);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
