import { logger } from '../../../lib/logger.js';
import type { BoardDueSource } from '../d-schedule-minutes/resolve-board-due-date.js';
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
  key: string;
  generationToken: string;
  savedAt: number;
  revision: number;
  source: LoadBalancingWorkspaceSource;
};
type ReadParams = {
  key: string;
  baseKey?: string;
  generationToken: string;
  load: () => Promise<LoadBalancingWorkspaceSource>;
  now?: () => number;
};
export type WorkspaceSourceCacheResult = {
  source: LoadBalancingWorkspaceSource;
  cacheHit: boolean;
  cacheState: 'fresh' | 'stale' | 'miss';
  revalidation?: Promise<void>;
};
const TTL_MS = 30 * 60 * 1000;
const MAX_STALE_MS = 6 * 60 * 60 * 1000;
const ACTIVE_MS = 3 * 60 * 60 * 1000;
const MAX_ENTRIES = 16;
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<LoadBalancingWorkspaceSource>>();
const warmers = new Map<string, { lastUsed: number; prepare: () => Promise<ReadParams> }>();
let revision = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let warming = false;

function trim<T>(map: Map<string, T>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function buildLoadBalancingWorkspaceSourceKey(params: {
  siteKey: string;
  deviceScopeKey: string;
  dueSource: BoardDueSource;
  fromMonth: string;
  toMonth: string;
  today: string;
}): string {
  return JSON.stringify([params.siteKey, params.deviceScopeKey, params.fromMonth, params.toMonth, params.today, params.dueSource]);
}

export function buildLoadBalancingWorkspaceSourceBaseKey(
  params: Omit<Parameters<typeof buildLoadBalancingWorkspaceSourceKey>[0], 'today'>
): string {
  return JSON.stringify([params.siteKey, params.deviceScopeKey, params.fromMonth, params.toMonth, params.dueSource]);
}

function loadSource(params: ReadParams): Promise<LoadBalancingWorkspaceSource> {
  const baseKey = params.baseKey ?? params.key;
  const inflightKey = JSON.stringify([baseKey, params.key, params.generationToken]);
  const running = inflight.get(inflightKey);
  if (running) return running;
  const loadRevision = ++revision;
  const promise = (async () => {
    const source = await params.load();
    // Tokens are opaque: load order, rather than lexical token order, determines freshness.
    if ((entries.get(baseKey)?.revision ?? 0) < loadRevision) {
      entries.delete(baseKey);
      entries.set(baseKey, {
        key: params.key, generationToken: params.generationToken,
        savedAt: (params.now ?? Date.now)(), revision: loadRevision, source
      });
      trim(entries);
    }
    return source;
  })().finally(() => {
    if (inflight.get(inflightKey) === promise) inflight.delete(inflightKey);
  });
  inflight.set(inflightKey, promise);
  return promise;
}

function logFailure(err: unknown): void {
  logger.warn({ err }, '[load-balancing-workspace] source revalidation failed');
}

export async function readLoadBalancingWorkspaceSourceWithCache(params: ReadParams): Promise<WorkspaceSourceCacheResult> {
  const now = (params.now ?? Date.now)();
  const baseKey = params.baseKey ?? params.key;
  const cached = entries.get(baseKey);
  if (cached) {
    entries.delete(baseKey);
    entries.set(baseKey, cached);
    if (cached.key === params.key && cached.generationToken === params.generationToken && now - cached.savedAt < TTL_MS) {
      return { source: cached.source, cacheHit: true, cacheState: 'fresh' };
    }
    if (now - cached.savedAt < MAX_STALE_MS) {
      const revalidation = loadSource(params).then(() => {}, logFailure);
      return { source: cached.source, cacheHit: true, cacheState: 'stale', revalidation };
    }
  }
  const cacheHit = inflight.has(JSON.stringify([baseKey, params.key, params.generationToken]));
  return { source: await loadSource(params), cacheHit, cacheState: 'miss' };
}

/** Service registers fresh generation/day readers; the cache never owns DB queries. */
export function registerLoadBalancingWorkspaceSourceWarmer(
  baseKey: string, prepare: () => Promise<ReadParams>
): void {
  warmers.delete(baseKey);
  warmers.set(baseKey, { lastUsed: Date.now(), prepare });
  trim(warmers);
  if (process.env.NODE_ENV !== 'test') startLoadBalancingWorkspaceSourceWarmer();
}

export function startLoadBalancingWorkspaceSourceWarmer(): void {
  if (timer) return;
  timer = setInterval(() => { void warmLoadBalancingWorkspaceSources(); }, 60_000);
  timer.unref();
}

export async function warmLoadBalancingWorkspaceSources(): Promise<void> {
  if (warming || inflight.size > 0) return;
  warming = true;
  try {
    for (const [baseKey, warmer] of warmers) {
      if (Date.now() - warmer.lastUsed >= ACTIVE_MS) {
        warmers.delete(baseKey);
        continue;
      }
      try {
        const params = await warmer.prepare();
        const result = await readLoadBalancingWorkspaceSourceWithCache(params);
        await result.revalidation;
      } catch (err) {
        logFailure(err);
      }
    }
  } finally {
    warming = false;
  }
}

/** テスト用。タイマーも停止する。 */
export function clearLoadBalancingWorkspaceSourceCacheForTests(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  entries.clear();
  inflight.clear();
  warmers.clear();
}
