import { ApiError } from './errors.js';
import { prisma } from './prisma.js';

/** overview の deviceScopeKey クエリで「旧 site 単位行」のみを対象にするための擬似キー */
export const MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY = '__legacy_site__';

export async function assertRegisteredDeviceScopeKey(deviceScopeKey: string): Promise<void> {
  const normalized = deviceScopeKey.trim();
  if (!normalized) {
    throw new ApiError(400, '操作対象端末(targetDeviceScopeKey)が不正です', undefined, 'TARGET_DEVICE_SCOPE_KEY_INVALID');
  }
  const device = await prisma.clientDevice.findFirst({
    where: { location: normalized },
    select: { id: true }
  });
  if (!device) {
    throw new ApiError(403, '指定された端末は登録されていません', undefined, 'UNKNOWN_DEVICE_SCOPE_KEY');
  }
}

export async function listRegisteredDeviceScopeKeysForSite(siteKey: string): Promise<string[]> {
  const normalizedSite = siteKey.trim();
  if (!normalizedSite) {
    return [];
  }
  // 拠点は明示設定（ClientDevice.siteKey）だけで判定する。未設定の端末は代理操作の対象に出さない。
  const rows = await prisma.clientDevice.findMany({
    where: { siteKey: normalizedSite, location: { not: null } },
    select: { location: true }
  });
  const unique = new Set<string>();
  for (const row of rows) {
    const loc = row.location?.trim() ?? '';
    if (loc) unique.add(loc);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b, 'ja'));
}
