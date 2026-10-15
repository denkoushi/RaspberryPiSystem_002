import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listKnownScheduleFseibans: vi.fn() }));
import { listKnownScheduleFseibans } from '../../production-schedule/production-schedule-lookup.service.js';
import { getKnownFseibans, KNOWN_FSEIBAN_CACHE_TTL_MS, resetKnownFseibanCache } from '../known-fseiban-cache.js';
beforeEach(() => { resetKnownFseibanCache(); vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
it('caches for five minutes and can be reset', async () => {
  vi.mocked(listKnownScheduleFseibans).mockResolvedValue(['BE1N9321']);
  expect(await getKnownFseibans()).toEqual(['BE1N9321']);
  await getKnownFseibans();
  expect(listKnownScheduleFseibans).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(KNOWN_FSEIBAN_CACHE_TTL_MS);
  await getKnownFseibans();
  expect(listKnownScheduleFseibans).toHaveBeenCalledTimes(2);
  resetKnownFseibanCache();
  await getKnownFseibans();
  expect(listKnownScheduleFseibans).toHaveBeenCalledTimes(3);
});
it('does not cache failures', async () => {
  vi.mocked(listKnownScheduleFseibans).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue([]);
  await expect(getKnownFseibans()).rejects.toThrow('unavailable');
  expect(await getKnownFseibans()).toEqual([]);
});
