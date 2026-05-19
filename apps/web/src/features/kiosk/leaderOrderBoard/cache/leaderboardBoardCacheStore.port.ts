import type { PersistedLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';

export type LeaderboardBoardCacheStore = {
  get(cacheKey: string): Promise<PersistedLeaderboardBoardCacheRecord | null>;
  put(record: PersistedLeaderboardBoardCacheRecord): Promise<void>;
  delete(cacheKey: string): Promise<void>;
};
