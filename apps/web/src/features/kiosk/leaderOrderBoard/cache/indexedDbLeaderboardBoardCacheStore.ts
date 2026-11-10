import { openDB, type IDBPDatabase } from 'idb';

import {
  LEADERBOARD_BOARD_CACHE_IDB_NAME,
  LEADERBOARD_BOARD_CACHE_IDB_STORE
} from './leaderboardBoardCacheConstants';
import { parseLeaderboardBoardCacheRecord, type PersistedLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';

import type { LeaderboardBoardCacheStore } from './leaderboardBoardCacheStore.port';

type CacheDb = IDBPDatabase<{
  [LEADERBOARD_BOARD_CACHE_IDB_STORE]: {
    key: string;
    value: PersistedLeaderboardBoardCacheRecord;
  };
}>;

let dbPromise: Promise<CacheDb> | null = null;

function getDb(): Promise<CacheDb> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = openDB(LEADERBOARD_BOARD_CACHE_IDB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(LEADERBOARD_BOARD_CACHE_IDB_STORE)) {
          db.createObjectStore(LEADERBOARD_BOARD_CACHE_IDB_STORE, { keyPath: 'cacheKey' });
        }
      }
    });
  }
  return dbPromise;
}

export function createIndexedDbLeaderboardBoardCacheStore(): LeaderboardBoardCacheStore {
  return {
    async get(cacheKey) {
      if (cacheKey.trim().length === 0) return null;
      try {
        const db = await getDb();
        const raw = await db.get(LEADERBOARD_BOARD_CACHE_IDB_STORE, cacheKey);
        return parseLeaderboardBoardCacheRecord(raw);
      } catch {
        return null;
      }
    },
    async put(record) {
      try {
        const db = await getDb();
        const tx = db.transaction(LEADERBOARD_BOARD_CACHE_IDB_STORE, 'readwrite');
        // abort 時も tx.done の拒否を未処理にしない。
        const done = tx.done.catch(() => {});
        try {
          await tx.store.put(record);
          const count = await tx.store.count();
          if (count > 30) {
            // 端末の時計が戻っていても、いま保存した控えは消さない。
            const records = (await tx.store.getAll()).filter((value) => value.cacheKey !== record.cacheKey);
            const savedAt = (value: PersistedLeaderboardBoardCacheRecord) =>
              Number.isFinite(value.savedAt) ? value.savedAt : 0;
            records.sort((a, b) => savedAt(a) - savedAt(b));
            for (const oldest of records.slice(0, count - 30)) {
              await tx.store.delete(oldest.cacheKey);
            }
          }
        } finally {
          await done;
        }
      } catch {
        /* ignore */
      }
    },
    async delete(cacheKey) {
      if (cacheKey.trim().length === 0) return;
      try {
        const db = await getDb();
        await db.delete(LEADERBOARD_BOARD_CACHE_IDB_STORE, cacheKey);
      } catch {
        /* ignore */
      }
    }
  };
}

/** テスト用: モジュール内 DB プロミスをリセット */
export function resetIndexedDbLeaderboardBoardCacheStoreForTests(): void {
  dbPromise = null;
}

export const defaultLeaderboardBoardCacheStore = createIndexedDbLeaderboardBoardCacheStore();
