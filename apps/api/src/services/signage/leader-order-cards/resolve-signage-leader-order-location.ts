import { env } from '../../../config/env.js';
import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';

/**
 * サイネージ設定の deviceScopeKey から生産スケジュール一覧クエリ用のキーを解決する。
 * キオスク HTTP ルートの v2 解決と同趣旨（端末が無いため siteKey のみに寄せる）。
 */
export async function resolveSignageLeaderOrderQueryKeys(deviceScopeKey: string): Promise<{
  locationKey: string;
  siteKey: string | undefined;
}> {
  const trimmed = deviceScopeKey.trim();
  if (!env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
    return { locationKey: trimmed, siteKey: undefined };
  }
  const siteKey = await resolveSiteKeyFromScopeKey(trimmed);
  return { locationKey: siteKey, siteKey };
}
