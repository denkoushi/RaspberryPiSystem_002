import { env } from '../../config/env.js';
import { machineNameCatalogRepository } from './machine-name-catalog.repository.js';
import { normalizeMachineNameForCompare } from './machine-name-compare.js';

const matchingFseibansByMachineNameCache = new Map<
  string,
  { expiresAt: number; fseibans: string[] }
>();

function resolveCacheTtlMs(): number {
  return env.PRODUCTION_SCHEDULE_MACHINE_NAME_FSEIBAN_CACHE_TTL_MS;
}

function isCacheEntryValid(expiresAt: number, ttlMs: number): boolean {
  return ttlMs > 0 && expiresAt > Date.now();
}

function pruneExpiredMatchingFseibanCache(ttlMs: number, now = Date.now()): void {
  if (ttlMs <= 0) {
    matchingFseibansByMachineNameCache.clear();
    return;
  }
  for (const [machineName, entry] of matchingFseibansByMachineNameCache.entries()) {
    if (entry.expiresAt <= now) {
      matchingFseibansByMachineNameCache.delete(machineName);
    }
  }
}

/** 正規化済み機種名に一致する FSEIBAN 一覧（共通カタログの短TTLキャッシュ付き） */
export async function resolveMatchingFseibansByNormalizedMachineName(
  normalizedMachineName: string
): Promise<string[]> {
  if (!normalizedMachineName) return [];

  const ttlMs = resolveCacheTtlMs();
  pruneExpiredMatchingFseibanCache(ttlMs);
  const cached = matchingFseibansByMachineNameCache.get(normalizedMachineName);
  if (cached && isCacheEntryValid(cached.expiresAt, ttlMs)) {
    return cached.fseibans;
  }

  const entries = await machineNameCatalogRepository.list();
  const fseibans = [
    ...new Set(
      entries
        .filter((entry) => normalizeMachineNameForCompare(entry.machineName) === normalizedMachineName)
        .map((entry) => entry.fseiban)
    ),
  ];

  if (ttlMs > 0) {
    matchingFseibansByMachineNameCache.set(normalizedMachineName, {
      fseibans,
      expiresAt: Date.now() + ttlMs,
    });
  }
  return fseibans;
}

/** テスト/取り込み後の共通カタログと解決結果キャッシュ無効化 */
export function resetMachineNameFseibanMatchCaches(): void {
  machineNameCatalogRepository.invalidate();
  matchingFseibansByMachineNameCache.clear();
}
