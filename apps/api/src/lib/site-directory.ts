import { resolveDeviceScopeKey, resolveSiteKeyFromScopeKey } from './location-scope-resolver.js';

/**
 * 端末スコープキー（deviceScopeKey）→ 明示拠点（ClientDevice.siteKey）の対応表。
 *
 * 拠点を scope 文字列だけから求める経路（手動順番・分割・負荷調整・設定など）で、
 * 端末に明示拠点があればそれを使い、なければ従来の文字列推測に戻す。
 * ClientDevice は十数行なので全件をメモリに保持し、TTL 付きで読み直す。
 * DB に依存しない純粋な参照関数にするため、prisma は呼び出し側から渡す。
 */

export type SiteDirectoryDeviceRow = {
  name: string;
  location: string | null;
  siteKey: string | null;
};

export type SiteDirectoryClient = {
  clientDevice: {
    findMany(args: {
      select: { name: true; location: true; siteKey: true };
    }): Promise<SiteDirectoryDeviceRow[]>;
  };
};

export const SITE_DIRECTORY_TTL_MS = 30_000;

let explicitSiteByDeviceScopeKey: ReadonlyMap<string, string> = new Map();
let lastAttemptAt = 0;
let inflight: Promise<void> | null = null;

/**
 * 同じ deviceScopeKey に異なる明示拠点が付いた端末がある場合は曖昧なので登録しない
 * （従来の文字列推測に戻る）。
 */
export function buildExplicitSiteMap(rows: readonly SiteDirectoryDeviceRow[]): Map<string, string> {
  const map = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const row of rows) {
    const siteKey = row.siteKey?.trim();
    if (!siteKey) continue;
    const deviceScopeKey = resolveDeviceScopeKey(row);
    const existing = map.get(deviceScopeKey);
    if (existing !== undefined && existing !== siteKey) {
      conflicting.add(deviceScopeKey);
      continue;
    }
    map.set(deviceScopeKey, siteKey);
  }
  for (const key of conflicting) {
    map.delete(key);
  }
  return map;
}

export async function refreshSiteDirectory(client: SiteDirectoryClient, now: number = Date.now()): Promise<void> {
  lastAttemptAt = now;
  const rows = await client.clientDevice.findMany({ select: { name: true, location: true, siteKey: true } });
  explicitSiteByDeviceScopeKey = buildExplicitSiteMap(rows);
}

/**
 * TTL 切れなら読み直す。失敗しても前回の対応表を維持し、TTL 経過まで再試行しない。
 */
export async function ensureSiteDirectoryFresh(client: SiteDirectoryClient, now: number = Date.now()): Promise<void> {
  if (now - lastAttemptAt < SITE_DIRECTORY_TTL_MS) return;
  if (!inflight) {
    inflight = refreshSiteDirectory(client, now).finally(() => {
      inflight = null;
    });
  }
  await inflight;
}

/** 管理画面で端末の拠点を変えた直後などに、次の参照で読み直させる。 */
export function invalidateSiteDirectory(): void {
  lastAttemptAt = 0;
}

/**
 * scope 文字列（deviceScopeKey または既に siteKey の値）から拠点を求める。
 * 登録端末の deviceScopeKey に明示拠点があればそれを、なければ従来の推測を返す。
 */
export function resolveSiteKeyForScopeKey(scopeKey: string): string {
  const trimmed = scopeKey.trim();
  return explicitSiteByDeviceScopeKey.get(trimmed) ?? resolveSiteKeyFromScopeKey(trimmed);
}

export function resetSiteDirectoryForTest(): void {
  explicitSiteByDeviceScopeKey = new Map();
  lastAttemptAt = 0;
  inflight = null;
}
