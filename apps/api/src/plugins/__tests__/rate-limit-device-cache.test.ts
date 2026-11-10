import { describe, expect, it, vi } from 'vitest';
import { createRateLimitDeviceCache } from '../rate-limit-device-cache.js';

describe('createRateLimitDeviceCache', () => {
  it('reuses a cached device lookup', async () => {
    const lookup = vi.fn().mockResolvedValue({ id: 'device-a' });
    const cache = createRateLimitDeviceCache({ lookup });
    expect(await cache('key-a', 'source-a')).toBe('device-a');
    expect(await cache('key-a', 'source-a')).toBe('device-a');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('expires entries after 60 seconds', async () => {
    let time = 0;
    const lookup = vi.fn().mockResolvedValueOnce({ id: 'device-a' }).mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup, now: () => time });
    await cache('key-a', 'source-a');
    time = 59_999;
    expect(await cache('key-a', 'source-a')).toBe('device-a');
    time = 60_000;
    expect(await cache('key-a', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry above 1000 entries without refreshing on hits', async () => {
    const lookup = vi.fn().mockResolvedValue({ id: 'device-a' });
    const cache = createRateLimitDeviceCache({ lookup, maxLookupsPerSource: 2000 });
    for (let i = 0; i < 1000; i++) await cache(`key-${i}`, 'source-a');
    await cache('key-0', 'source-a');
    await cache('key-1000', 'source-a');
    await cache('key-1', 'source-a');
    expect(lookup).toHaveBeenCalledTimes(1001);
    await cache('key-0', 'source-a');
    expect(lookup).toHaveBeenCalledTimes(1002);
  });

  it('caches negative lookups', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup });
    expect(await cache('unknown', 'source-a')).toBeNull();
    expect(await cache('unknown', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('falls back on lookup errors and allows recovery', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValue({ id: 'device-a' });
    const cache = createRateLimitDeviceCache({ lookup });
    expect(await cache('key-a', 'source-a')).toBeNull();
    expect(await cache('key-a', 'source-a')).toBe('device-a');
  });

  it('skips lookups after 30 misses from one source', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup, now: () => 0 });
    for (let i = 0; i < 30; i++) await cache(`unknown-${i}`, 'source-a');
    expect(lookup).toHaveBeenCalledTimes(30);
    expect(await cache('unknown-30', 'source-a')).toBeNull();
    expect(await cache('unknown-31', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(30);
  });

  it('keeps a separate miss budget for each source', async () => {
    const lookup = vi.fn().mockResolvedValue({ id: 'device-b' });
    const cache = createRateLimitDeviceCache({ lookup, maxLookupsPerSource: 1 });
    await cache('key-a', 'source-a');
    expect(await cache('key-b', 'source-a')).toBeNull();
    expect(await cache('key-b', 'source-b')).toBe('device-b');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('does not count cache hits and keeps resolving cached keys when over budget', async () => {
    const lookup = vi.fn().mockResolvedValueOnce({ id: 'device-a' }).mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup, maxLookupsPerSource: 2 });
    expect(await cache('key-a', 'source-a')).toBe('device-a');
    for (let i = 0; i < 5; i++) expect(await cache('key-a', 'source-a')).toBe('device-a');
    expect(await cache('unknown', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await cache('over-budget', 'source-a')).toBeNull();
    expect(await cache('key-a', 'source-a')).toBe('device-a');
    expect(await cache('unknown', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('resets the miss budget after 60 seconds without extending it on blocked attempts', async () => {
    let time = 0;
    const lookup = vi.fn().mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup, now: () => time, maxLookupsPerSource: 1 });
    await cache('unknown-a', 'source-a');
    time = 59_999;
    expect(await cache('unknown-b', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    time = 60_000;
    expect(await cache('unknown-b', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenLastCalledWith('unknown-b');
  });

  it('counts in-flight and failed lookups toward the miss budget', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('Database unavailable'));
    const cache = createRateLimitDeviceCache({ lookup, maxLookupsPerSource: 1 });
    expect(await Promise.all([
      cache('unknown-a', 'source-a'), cache('unknown-b', 'source-a'), cache('unknown-c', 'source-a')
    ])).toEqual([null, null, null]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await cache('unknown-d', 'source-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest source above 1000 sources without refreshing on blocked attempts', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup, maxLookupsPerSource: 1, now: () => 0 });
    for (let i = 0; i < 1000; i++) await cache(`key-${i}`, `source-${i}`);
    await cache('blocked', 'source-0');
    await cache('key-1000', 'source-1000');
    await cache('blocked', 'source-1');
    expect(lookup).toHaveBeenCalledTimes(1001);
    await cache('new-key', 'source-0');
    expect(lookup).toHaveBeenCalledTimes(1002);
  });
});
