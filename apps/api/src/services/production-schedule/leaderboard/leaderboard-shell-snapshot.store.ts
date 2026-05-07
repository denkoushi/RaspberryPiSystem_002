import { randomUUID } from 'node:crypto';

export type LeaderboardShellSnapshotRecord = {
  readonly orderedRowIds: readonly string[];
  readonly filterFingerprint: string;
  readonly generationToken: string;
  readonly locationKey: string;
  readonly siteKey: string | undefined;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
};

export type LeaderboardShellSnapshotStoreOptions = {
  /** snapshot の生存時間（ミリ秒） */
  defaultTtlMs: number;
};

/**
 * 順位ボード shell 応答で固定した並びを、continue で再計算せず引き継ぐためのストア。
 * まずはプロセス内 TTL。将来 Redis 等へ `LeaderboardShellSnapshotStore` を差し替え可能。
 */
export interface LeaderboardShellSnapshotStore {
  /**
   * snapshot を登録し snapshotId を返す。
   */
  create(record: {
    orderedRowIds: readonly string[];
    filterFingerprint: string;
    generationToken: string;
    locationKey: string;
    siteKey: string | undefined;
  }): string;

  get(snapshotId: string): LeaderboardShellSnapshotRecord | undefined;

  delete(snapshotId: string): void;

  /**
   * 同一 snapshot への continue を直列化する（暴走・二重取得対策）。
   */
  withContinueLock<T>(snapshotId: string, fn: () => Promise<T>): Promise<T>;
}

type MutableRecord = LeaderboardShellSnapshotRecord;

/**
 * Map 化された Promise チェーンで、同一キーの非同期処理を直列化する。
 */
function createContinueLocker() {
  const tails = new Map<string, Promise<unknown>>();

  return async function withContinueLock<T>(snapshotId: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(snapshotId) ?? Promise.resolve();
    const next: Promise<T> = prev.then(() => fn());
    const tail = next.catch(() => {});
    tails.set(snapshotId, tail);
    try {
      return await next;
    } finally {
      const currentTail = tails.get(snapshotId);
      if (currentTail === tail || currentTail == null) {
        tails.delete(snapshotId);
      }
    }
  };
}

export function createInMemoryLeaderboardShellSnapshotStore(
  options: LeaderboardShellSnapshotStoreOptions
): LeaderboardShellSnapshotStore {
  const { defaultTtlMs } = options;
  const map = new Map<string, MutableRecord>();
  const withLock = createContinueLocker();

  function gc(): void {
    const now = Date.now();
    for (const [id, rec] of map) {
      if (rec.expiresAtMs < now) {
        map.delete(id);
      }
    }
  }

  return {
    create(record) {
      gc();
      const id = randomUUID();
      const now = Date.now();
      map.set(id, {
        orderedRowIds: Object.freeze([...record.orderedRowIds]) as readonly string[],
        filterFingerprint: record.filterFingerprint,
        generationToken: record.generationToken,
        locationKey: record.locationKey,
        siteKey: record.siteKey,
        createdAtMs: now,
        expiresAtMs: now + defaultTtlMs
      });
      return id;
    },
    get(snapshotId) {
      gc();
      const rec = map.get(snapshotId);
      if (!rec) return undefined;
      if (rec.expiresAtMs < Date.now()) {
        map.delete(snapshotId);
        return undefined;
      }
      return rec;
    },
    delete(snapshotId) {
      map.delete(snapshotId);
    },
    withContinueLock(snapshotId, fn) {
      return withLock(snapshotId, fn);
    }
  };
}
