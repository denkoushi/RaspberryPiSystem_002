import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';

export type LeaderboardCanonicalRowCoverage = 'identity' | 'planning' | 'rank';

export type LeaderboardCanonicalRowCacheKey = {
  siteKey: string;
  generationToken: string;
  /** Rank rows are location-scoped; identity/detail rows use `none`. */
  rankContext?: string;
};

type CacheEntry = {
  row: LeaderboardScheduleRowSql;
  coverage: ReadonlySet<LeaderboardCanonicalRowCoverage>;
};

type CacheBucket = {
  expiresAtMs: number;
  touchedAtMs: number;
  rows: Map<string, CacheEntry>;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_BUCKETS = 8;
const MAX_ROWS_PER_BUCKET = 40_000;

const buckets = new Map<string, CacheBucket>();
const inflight = new Map<string, Promise<readonly LeaderboardScheduleRowSql[]>>();

function cacheKey(key: LeaderboardCanonicalRowCacheKey): string {
  return JSON.stringify([key.siteKey, key.generationToken, key.rankContext ?? 'none']);
}

function ttlMs(): number {
  const configured = Number(process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS);
  return Number.isFinite(configured) && configured >= 30_000 ? configured : DEFAULT_TTL_MS;
}

function gc(now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAtMs < now) buckets.delete(key);
  }
  while (buckets.size > MAX_BUCKETS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].touchedAtMs - b[1].touchedAtMs)[0];
    if (!oldest) break;
    buckets.delete(oldest[0]);
  }
}

function bucketFor(key: LeaderboardCanonicalRowCacheKey, create: boolean): CacheBucket | undefined {
  const now = Date.now();
  gc(now);
  const id = cacheKey(key);
  let bucket = buckets.get(id);
  if (!bucket && create) {
    bucket = { expiresAtMs: now + ttlMs(), touchedAtMs: now, rows: new Map() };
    buckets.set(id, bucket);
    gc(now);
  }
  if (bucket) {
    bucket.expiresAtMs = now + ttlMs();
    bucket.touchedAtMs = now;
  }
  return bucket;
}

function normalizeRowIds(rowIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawId of rowIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function mergeCanonicalRow(
  previous: LeaderboardScheduleRowSql | undefined,
  row: LeaderboardScheduleRowSql,
  coverage: LeaderboardCanonicalRowCoverage
): LeaderboardScheduleRowSql {
  if (!previous) return row;

  // The planning supplement deliberately selects only a subset of the
  // canonical row. Preserve the identity/rank fields that it leaves null,
  // while allowing its nullable planning values (for example an unset due
  // date) to replace the previous value.
  if (coverage === 'planning') {
    return {
      ...row,
      rowData: previous.rowData,
      ...(row.seibanJoinKey == null ? { seibanJoinKey: previous.seibanJoinKey } : {}),
      ...(row.occurredAt == null ? { occurredAt: previous.occurredAt } : {}),
      ...(row.updatedAt == null ? { updatedAt: previous.updatedAt } : {}),
      ...(row.processingOrder == null ? { processingOrder: previous.processingOrder } : {}),
      ...(row.globalRank == null ? { globalRank: previous.globalRank } : {}),
      ...(row.note == null ? { note: previous.note } : {}),
      ...(row.processingType == null ? { processingType: previous.processingType } : {}),
      ...(row.planningDetail == null ? { planningDetail: previous.planningDetail } : {})
    };
  }

  return {
    ...row,
    ...(row.rowData == null ? { rowData: previous.rowData } : {}),
    ...(row.seibanJoinKey == null ? { seibanJoinKey: previous.seibanJoinKey } : {}),
    ...(row.occurredAt == null ? { occurredAt: previous.occurredAt } : {}),
    ...(row.updatedAt == null ? { updatedAt: previous.updatedAt } : {}),
    // Identity coverage does not select rank joins, so a null rank there is
    // an omitted field rather than an instruction to erase an existing rank.
    ...(coverage === 'identity' && row.processingOrder == null
      ? { processingOrder: previous.processingOrder }
      : {}),
    ...(coverage === 'identity' && row.globalRank == null
      ? { globalRank: previous.globalRank }
      : {}),
    // Rank and identity reads do not select the planning supplement.
    ...(row.planningDetail == null && previous.planningDetail != null
      ? { planningDetail: previous.planningDetail }
      : {})
  };
}

export function getLeaderboardCanonicalRows(params: {
  key: LeaderboardCanonicalRowCacheKey;
  rowIds: readonly string[];
  coverage: LeaderboardCanonicalRowCoverage;
}): { rows: LeaderboardScheduleRowSql[]; missingIds: string[] } {
  const bucket = bucketFor(params.key, false);
  const rows: LeaderboardScheduleRowSql[] = [];
  const missingIds: string[] = [];
  for (const id of normalizeRowIds(params.rowIds)) {
    const entry = bucket?.rows.get(id);
    if (!entry || !entry.coverage.has(params.coverage)) missingIds.push(id);
    else rows.push(entry.row);
  }
  return { rows, missingIds };
}

export function putLeaderboardCanonicalRows(params: {
  key: LeaderboardCanonicalRowCacheKey;
  rows: readonly LeaderboardScheduleRowSql[];
  coverage: LeaderboardCanonicalRowCoverage;
}): void {
  const bucket = bucketFor(params.key, true);
  if (!bucket) return;
  for (const row of params.rows) {
    const previous = bucket.rows.get(row.id);
    const coverage = new Set(previous?.coverage ?? []);
    coverage.add(params.coverage);
    if (params.coverage === 'rank' || params.coverage === 'planning') coverage.add('identity');
    bucket.rows.set(row.id, {
      row: mergeCanonicalRow(previous?.row, row, params.coverage),
      coverage
    });
  }
  if (bucket.rows.size > MAX_ROWS_PER_BUCKET) {
    const excess = bucket.rows.size - MAX_ROWS_PER_BUCKET;
    let removed = 0;
    for (const id of bucket.rows.keys()) {
      bucket.rows.delete(id);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

/** Exact missing-scope dedupe for concurrent consumers of the same canonical rows. */
export async function loadLeaderboardCanonicalRows(params: {
  key: LeaderboardCanonicalRowCacheKey;
  rowIds: readonly string[];
  coverage: LeaderboardCanonicalRowCoverage;
  load: (missingIds: readonly string[]) => Promise<readonly LeaderboardScheduleRowSql[]>;
}): Promise<LeaderboardScheduleRowSql[]> {
  const requestedIds = normalizeRowIds(params.rowIds);
  const scopedParams = { ...params, rowIds: requestedIds };
  const initial = getLeaderboardCanonicalRows(scopedParams);
  if (initial.missingIds.length === 0) {
    const byId = new Map(initial.rows.map((row) => [row.id, row]));
    return requestedIds.map((id) => byId.get(id)).filter((row): row is LeaderboardScheduleRowSql => row != null);
  }
  const requestKey = `${cacheKey(params.key)}|${params.coverage}|${JSON.stringify([...requestedIds].sort())}`;
  let pending = inflight.get(requestKey);
  if (!pending) {
    pending = (async () => {
      const current = getLeaderboardCanonicalRows(scopedParams);
      let loadedRows: readonly LeaderboardScheduleRowSql[] = [];
      if (current.missingIds.length > 0) {
        loadedRows = await params.load(current.missingIds);
        putLeaderboardCanonicalRows({ key: params.key, rows: loadedRows, coverage: params.coverage });
      }
      const identityRows = getLeaderboardCanonicalRows({ key: params.key, rowIds: requestedIds, coverage: 'identity' }).rows;
      const byId = new Map<string, LeaderboardScheduleRowSql>();
      for (const row of identityRows) byId.set(row.id, row);
      for (const row of current.rows) byId.set(row.id, mergeCanonicalRow(byId.get(row.id), row, params.coverage));
      for (const row of loadedRows) byId.set(row.id, mergeCanonicalRow(byId.get(row.id), row, params.coverage));
      return requestedIds.map((id) => byId.get(id)).filter((row): row is LeaderboardScheduleRowSql => row != null);
    })();
    inflight.set(requestKey, pending);
  }
  try {
    const resolved = await pending;
    const byId = new Map(resolved.map((row) => [row.id, row]));
    return requestedIds.map((id) => byId.get(id)).filter((row): row is LeaderboardScheduleRowSql => row != null);
  } finally {
    if (inflight.get(requestKey) === pending) inflight.delete(requestKey);
  }
}

export function clearLeaderboardCanonicalRowCacheForTests(): void {
  buckets.clear();
  inflight.clear();
}

export function getLatestLeaderboardCanonicalRows(params: {
  siteKey: string;
  generationToken: string;
  rankContext?: string;
  rowIds: readonly string[];
  coverage: LeaderboardCanonicalRowCoverage;
}): { generationToken: string | undefined; rows: LeaderboardScheduleRowSql[]; missingIds: string[] } {
  return {
    generationToken: params.generationToken,
    ...getLeaderboardCanonicalRows({ key: { siteKey: params.siteKey, generationToken: params.generationToken, rankContext: params.rankContext }, rowIds: params.rowIds, coverage: params.coverage })
  };
}
