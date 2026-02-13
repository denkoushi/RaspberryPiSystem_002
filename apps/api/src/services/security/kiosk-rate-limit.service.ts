import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  getSharedRedisClient,
  InMemoryRateLimiterStore,
  type RateLimiterStore,
  RedisRateLimiterStore,
} from './rate-limiter-store.js';

type AllowParams = {
  scope: 'kiosk-support' | 'kiosk-power';
  clientKey: string;
  ip: string;
  max: number;
  windowMs: number;
};

class KioskRateLimitService {
  constructor(
    private readonly primaryStore: RateLimiterStore,
    private readonly fallbackStore: RateLimiterStore
  ) {}

  async isAllowed(params: AllowParams): Promise<boolean> {
    const key = `kiosk:${params.scope}:${params.clientKey}:${params.ip}`;
    try {
      const count = await this.primaryStore.increment(key, params.windowMs);
      return count <= params.max;
    } catch (error) {
      logger.warn(
        { err: error, scope: params.scope, key },
        '[RateLimiter] Primary store failed. Falling back to in-memory store'
      );
      const fallbackCount = await this.fallbackStore.increment(key, params.windowMs);
      return fallbackCount <= params.max;
    }
  }
}

let kioskRateLimitService: KioskRateLimitService | null = null;

export const getKioskRateLimitService = (): KioskRateLimitService => {
  if (kioskRateLimitService) {
    return kioskRateLimitService;
  }

  const fallbackStore = new InMemoryRateLimiterStore();
  if (env.RATE_LIMIT_REDIS_URL) {
    const redis = getSharedRedisClient(env.RATE_LIMIT_REDIS_URL);
    kioskRateLimitService = new KioskRateLimitService(new RedisRateLimiterStore(redis), fallbackStore);
    return kioskRateLimitService;
  }

  kioskRateLimitService = new KioskRateLimitService(fallbackStore, fallbackStore);
  return kioskRateLimitService;
};
