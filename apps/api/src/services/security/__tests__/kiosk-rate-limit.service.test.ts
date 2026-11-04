import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { RATE_LIMIT_REDIS_URL: undefined as string | undefined },
  warn: vi.fn(),
  redisInstances: [] as Array<{
    url: string;
    options: unknown;
    store: Map<string, number>;
    incr: ReturnType<typeof vi.fn>;
    pexpire: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }>
}));

vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('ioredis', () => {
  class FakeRedis {
    store = new Map<string, number>();
    incr = vi.fn(async (key: string) => {
      const next = (this.store.get(key) ?? 0) + 1;
      this.store.set(key, next);
      return next;
    });
    pexpire = vi.fn(async () => 1);
    on = vi.fn();
    constructor(
      public url: string,
      public options: unknown
    ) {
      mocks.redisInstances.push(this);
    }
  }
  return { default: FakeRedis };
});

type StoreModule = typeof import('../rate-limiter-store.js');
type ServiceModule = typeof import('../kiosk-rate-limit.service.js');

async function loadModules(): Promise<{ store: StoreModule; service: ServiceModule }> {
  vi.resetModules();
  const store = await import('../rate-limiter-store.js');
  const service = await import('../kiosk-rate-limit.service.js');
  return { store, service };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
  mocks.env.RATE_LIMIT_REDIS_URL = undefined;
  mocks.redisInstances.length = 0;
  mocks.warn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InMemoryRateLimiterStore', () => {
  it('counts per key and resets after the window expires', async () => {
    const { store } = await loadModules();
    const limiter = new store.InMemoryRateLimiterStore();

    expect(await limiter.increment('k1', 1000)).toBe(1);
    expect(await limiter.increment('k1', 1000)).toBe(2);
    expect(await limiter.increment('k2', 1000)).toBe(1);

    vi.advanceTimersByTime(999);
    expect(await limiter.increment('k1', 1000)).toBe(3);

    vi.advanceTimersByTime(1);
    expect(await limiter.increment('k1', 1000)).toBe(1);
  });

  it('keeps the original expiry instead of sliding the window on every hit', async () => {
    const { store } = await loadModules();
    const limiter = new store.InMemoryRateLimiterStore();
    await limiter.increment('k', 1000);
    vi.advanceTimersByTime(600);
    await limiter.increment('k', 1000);
    vi.advanceTimersByTime(400);
    expect(await limiter.increment('k', 1000)).toBe(1);
  });
});

describe('RedisRateLimiterStore', () => {
  it('sets the TTL only on the first increment of a key', async () => {
    const { store } = await loadModules();
    const redis = store.getSharedRedisClient('redis://fake:6379');
    const limiter = new store.RedisRateLimiterStore(redis);

    expect(await limiter.increment('a', 5000)).toBe(1);
    expect(await limiter.increment('a', 5000)).toBe(2);
    expect(await limiter.increment('b', 7000)).toBe(1);

    const fake = mocks.redisInstances[0];
    expect(fake.pexpire.mock.calls).toEqual([
      ['a', 5000],
      ['b', 7000]
    ]);
  });

  it('reuses one shared Redis client and registers an error listener', async () => {
    const { store } = await loadModules();
    const first = store.getSharedRedisClient('redis://one:6379');
    const second = store.getSharedRedisClient('redis://two:6379');
    expect(second).toBe(first);
    expect(mocks.redisInstances).toHaveLength(1);
    expect(mocks.redisInstances[0].url).toBe('redis://one:6379');
    expect(mocks.redisInstances[0].options).toEqual({ maxRetriesPerRequest: 1, enableReadyCheck: true });
    expect(mocks.redisInstances[0].on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('getKioskRateLimitService', () => {
  const params = { scope: 'kiosk-support' as const, clientKey: 'key-a', ip: '10.0.0.1', max: 3, windowMs: 60_000 };

  it('allows up to max requests per window and denies the next one (in-memory)', async () => {
    const { service } = await loadModules();
    const limiter = service.getKioskRateLimitService();
    expect(await limiter.isAllowed(params)).toBe(true);
    expect(await limiter.isAllowed(params)).toBe(true);
    expect(await limiter.isAllowed(params)).toBe(true);
    expect(await limiter.isAllowed(params)).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(await limiter.isAllowed(params)).toBe(true);
    expect(mocks.redisInstances).toHaveLength(0);
  });

  it('separates counters by scope, client key and IP', async () => {
    const { service } = await loadModules();
    const limiter = service.getKioskRateLimitService();
    const one = { ...params, max: 1 };
    expect(await limiter.isAllowed(one)).toBe(true);
    expect(await limiter.isAllowed(one)).toBe(false);
    expect(await limiter.isAllowed({ ...one, scope: 'kiosk-power' })).toBe(true);
    expect(await limiter.isAllowed({ ...one, clientKey: 'key-b' })).toBe(true);
    expect(await limiter.isAllowed({ ...one, ip: '10.0.0.2' })).toBe(true);
  });

  it('returns the same singleton instance', async () => {
    const { service } = await loadModules();
    expect(service.getKioskRateLimitService()).toBe(service.getKioskRateLimitService());
  });

  it('uses Redis with the namespaced key when RATE_LIMIT_REDIS_URL is set', async () => {
    mocks.env.RATE_LIMIT_REDIS_URL = 'redis://rate:6379';
    const { service } = await loadModules();
    const limiter = service.getKioskRateLimitService();
    expect(await limiter.isAllowed({ ...params, max: 1 })).toBe(true);
    expect(await limiter.isAllowed({ ...params, max: 1 })).toBe(false);
    expect(mocks.redisInstances[0].incr).toHaveBeenCalledWith('kiosk:kiosk-support:key-a:10.0.0.1');
    expect(mocks.redisInstances[0].pexpire).toHaveBeenCalledWith('kiosk:kiosk-support:key-a:10.0.0.1', 60_000);
  });

  it('falls back to the in-memory store (still enforcing the limit) when Redis fails', async () => {
    mocks.env.RATE_LIMIT_REDIS_URL = 'redis://rate:6379';
    const { service } = await loadModules();
    const limiter = service.getKioskRateLimitService();
    mocks.redisInstances[0].incr.mockRejectedValue(new Error('ECONNREFUSED'));

    const one = { ...params, max: 1 };
    expect(await limiter.isAllowed(one)).toBe(true);
    expect(await limiter.isAllowed(one)).toBe(false);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'kiosk-support', key: 'kiosk:kiosk-support:key-a:10.0.0.1' }),
      expect.stringContaining('Falling back')
    );
  });
});
