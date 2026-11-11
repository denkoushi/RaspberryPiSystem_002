import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import {
  createIndexedDbLeaderboardBoardCacheStore,
  resetIndexedDbLeaderboardBoardCacheStoreForTests
} from '../indexedDbLeaderboardBoardCacheStore';
import { LEADERBOARD_BOARD_CACHE_IDB_STORE } from '../leaderboardBoardCacheConstants';
import { buildLeaderboardBoardCacheRecord } from '../leaderboardBoardCacheRecord';

const mocks = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock('idb', () => ({ openDB: mocks.openDB }));

function record(cacheKey: string, savedAt: number) {
  return buildLeaderboardBoardCacheRecord({
    cacheKey, savedAt, siteKey: 'site', paramsKey: cacheKey,
    board: { page: 1, pageSize: 80, total: 0, rows: [], resources: [] },
    decorations: createEmptyAccumulatedLeaderboardDecorations()
  })!;
}

describe('IndexedDB board cache retention', () => {
  let records: Map<string, ReturnType<typeof record>>;
  let store: ReturnType<typeof createIndexedDbLeaderboardBoardCacheStore>;
  let objectStore: {
    put: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let transaction: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('indexedDB', {});
    resetIndexedDbLeaderboardBoardCacheStoreForTests();
    records = new Map();
    objectStore = {
      put: vi.fn(async (value: ReturnType<typeof record>) => { records.set(value.cacheKey, value); }),
      count: vi.fn(async () => records.size),
      getAll: vi.fn(async () => [...records.values()]),
      delete: vi.fn(async (key: string) => { records.delete(key); })
    };
    transaction = vi.fn(() => ({ store: objectStore, done: Promise.resolve() }));
    mocks.openDB.mockReset().mockResolvedValue({
      transaction,
      // 旧実装でも保存できるようにし、上限に関するassertionで失敗させる。
      put: vi.fn(async (_name: string, value: ReturnType<typeof record>) => { records.set(value.cacheKey, value); }),
      get: vi.fn(async (_name: string, key: string) => records.get(key))
    });
    store = createIndexedDbLeaderboardBoardCacheStore();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('30件までは削除せず、31件目は保存時刻が最も古いものを消す', async () => {
    for (let n = 30; n >= 1; n--) await store.put(record(`key-${n}`, n));
    expect(records.size).toBe(30);
    expect(objectStore.delete).not.toHaveBeenCalled();
    await store.put(record('new', 31));
    expect(records.size).toBe(30);
    expect(records.has('key-1')).toBe(false);
    expect(await store.get('new')).toEqual(record('new', 31));
    expect(transaction).toHaveBeenCalledWith(LEADERBOARD_BOARD_CACHE_IDB_STORE, 'readwrite');
  });

  it('既存の超過分も削除し、時刻なしは最古、同一キーの更新は件数を増やさない', async () => {
    for (let n = 1; n <= 35; n++) records.set(`key-${n}`, record(`key-${n}`, n));
    records.set('legacy', { ...record('legacy', 0), savedAt: undefined } as unknown as ReturnType<typeof record>);
    await store.put(record('key-1', 100));
    expect(records.size).toBe(30);
    expect(records.has('legacy')).toBe(false);
    expect(records.has('key-2')).toBe(false);
    expect(records.has('key-6')).toBe(false);
    expect(records.has('key-7')).toBe(true);
    expect(records.get('key-1')?.savedAt).toBe(100);
  });

  it('端末の時計が戻っていても、いま保存した控えは残す', async () => {
    for (let n = 1; n <= 30; n++) records.set(`key-${n}`, record(`key-${n}`, 1000 + n));
    await store.put(record('new', 5));
    expect(records.size).toBe(30);
    expect(records.has('new')).toBe(true);
    expect(records.has('key-1')).toBe(false);
  });

  it('掃除に失敗しても拒否を外へ漏らさない', async () => {
    objectStore.count.mockRejectedValue(new Error('storage unavailable'));
    await expect(store.put(record('new', 1))).resolves.toBeUndefined();
  });

  it('DBを開けなくてもget/putの例外を外へ漏らさない', async () => {
    mocks.openDB.mockRejectedValue(new Error('open failed'));
    await expect(store.put(record('new', 1))).resolves.toBeUndefined();
    await expect(store.get('new')).resolves.toBeNull();
  });
});
