import type { StartDateLevelingQueryRow } from './start-date-leveling.types.js';

/**
 * 負荷調整ワークスペースの重い元データ（winner 行 + 工程行クエリ + 機種名）を、
 * 順位ボード・製番ボードと同じ世代トークンが変わるまで使い回す。
 * 能力・分類などの設定は軽いので毎回読む（キオスクからの能力編集をすぐ反映するため）。
 */
export type LoadBalancingWorkspaceSource = {
  queryRows: StartDateLevelingQueryRow[];
  machineNames: Record<string, string | null>;
};

type Entry = {
  generationToken: string;
  expiresAt: number;
  source: LoadBalancingWorkspaceSource;
};

type Inflight = {
  generationToken: string;
  promise: Promise<LoadBalancingWorkspaceSource>;
};

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 16;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Inflight>();

export function buildLoadBalancingWorkspaceSourceKey(params: {
  siteKey: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  today: string;
}): string {
  return JSON.stringify([params.siteKey, params.deviceScopeKey, params.fromMonth, params.toMonth, params.today]);
}

/** 同じ key・同じ世代なら保存済みを返し、同時の読み込みは 1 回にまとめる */
export async function readLoadBalancingWorkspaceSourceWithCache(params: {
  key: string;
  generationToken: string;
  load: () => Promise<LoadBalancingWorkspaceSource>;
  now?: () => number;
}): Promise<{ source: LoadBalancingWorkspaceSource; cacheHit: boolean }> {
  const now = params.now ?? Date.now;
  const cached = entries.get(params.key);
  if (cached && cached.generationToken === params.generationToken && cached.expiresAt > now()) {
    // 最近使ったものを末尾へ（古いものから捨てる）
    entries.delete(params.key);
    entries.set(params.key, cached);
    return { source: cached.source, cacheHit: true };
  }

  const running = inflight.get(params.key);
  if (running && running.generationToken === params.generationToken) {
    return { source: await running.promise, cacheHit: true };
  }

  const promise = params
    .load()
    .then((source) => {
      entries.delete(params.key);
      entries.set(params.key, { generationToken: params.generationToken, expiresAt: now() + TTL_MS, source });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return source;
    })
    .finally(() => {
      if (inflight.get(params.key)?.promise === promise) inflight.delete(params.key);
    });
  inflight.set(params.key, { generationToken: params.generationToken, promise });
  return { source: await promise, cacheHit: false };
}

/** テスト用 */
export function clearLoadBalancingWorkspaceSourceCacheForTests(): void {
  entries.clear();
  inflight.clear();
}
