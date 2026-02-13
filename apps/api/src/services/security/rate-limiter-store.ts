import Redis from 'ioredis';
import { logger } from '../../lib/logger.js';

export interface RateLimiterStore {
  increment(key: string, windowMs: number): Promise<number>;
}

export class InMemoryRateLimiterStore implements RateLimiterStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry || entry.expiresAt <= now) {
      this.entries.set(key, { count: 1, expiresAt: now + windowMs });
      this.gc(now);
      return 1;
    }

    const nextCount = entry.count + 1;
    this.entries.set(key, { count: nextCount, expiresAt: entry.expiresAt });
    return nextCount;
  }

  private gc(now: number): void {
    if (this.entries.size < 1000) {
      return;
    }
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export class RedisRateLimiterStore implements RateLimiterStore {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.pexpire(key, windowMs);
    }
    return count;
  }
}

let sharedRedisClient: Redis | null = null;

export const getSharedRedisClient = (redisUrl: string): Redis => {
  if (!sharedRedisClient) {
    sharedRedisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    sharedRedisClient.on('error', (error) => {
      logger.warn({ err: error }, '[RateLimiter] Redis client error');
    });
  }
  return sharedRedisClient;
};
