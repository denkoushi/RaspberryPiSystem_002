import { describe, expect, it, vi } from 'vitest';
import { createRateLimitDeviceCache } from '../rate-limit-device-cache.js';

describe('createRateLimitDeviceCache', () => {
  it('reuses a cached device lookup', async () => {
    const lookup = vi.fn().mockResolvedValue({ id: 'device-a' });
    const cache = createRateLimitDeviceCache({ lookup });
    expect(await cache('key-a')).toBe('device-a');
    expect(await cache('key-a')).toBe('device-a');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('expires entries after 60 seconds', async () => {
    let time = 0;
    const lookup = vi.fn().mockResolvedValueOnce({ id: 'device-a' }).mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup, now: () => time });
    await cache('key-a');
    time = 59_999;
    expect(await cache('key-a')).toBe('device-a');
    time = 60_000;
    expect(await cache('key-a')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry above 1000 entries without refreshing on hits', async () => {
    const lookup = vi.fn().mockResolvedValue({ id: 'device-a' });
    const cache = createRateLimitDeviceCache({ lookup });
    for (let i = 0; i < 1000; i++) await cache(`key-${i}`);
    await cache('key-0');
    await cache('key-1000');
    await cache('key-1');
    expect(lookup).toHaveBeenCalledTimes(1001);
    await cache('key-0');
    expect(lookup).toHaveBeenCalledTimes(1002);
  });

  it('caches negative lookups', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const cache = createRateLimitDeviceCache({ lookup });
    expect(await cache('unknown')).toBeNull();
    expect(await cache('unknown')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('falls back on lookup errors and allows recovery', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValue({ id: 'device-a' });
    const cache = createRateLimitDeviceCache({ lookup });
    expect(await cache('key-a')).toBeNull();
    expect(await cache('key-a')).toBe('device-a');
  });
});
