import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { assertRegisteredDeviceScopeKey } from '../../../lib/manual-order-device-scope.js';
import { resolveSiteKeyForScopeKey } from '../../../lib/site-directory.js';
import { canProxyTargetLocation } from '../shared.js';

/**
 * 生産スケジュールの手動順番（assignment）参照・更新で使う location（deviceScopeKey）を解決する。
 * v2 有効時: Mac は targetDeviceScopeKey 必須、キオスクは自端末のみ。
 * ただし保存単位は工場共有（siteKey canonical）に寄せるため、
 * 解決結果は siteKey を返す。
 */
export async function resolveProductionScheduleAssignmentLocationKey(params: {
  actorDeviceScopeKey: string;
  /** 呼び出し端末の `ClientDevice.canProxyOtherDevices`（旧: deviceScopeKey が 'Mac'） */
  actorCanProxyOtherDevices: boolean;
  targetDeviceScopeKey?: string;
}): Promise<string> {
  const actor = params.actorDeviceScopeKey.trim();
  if (!env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
    return actor;
  }
  const requested = params.targetDeviceScopeKey?.trim();
  if (canProxyTargetLocation({ canProxyOtherDevices: params.actorCanProxyOtherDevices })) {
    if (!requested) {
      throw new ApiError(
        400,
        'Mac端末では対象端末(targetDeviceScopeKey)の指定が必要です',
        undefined,
        'TARGET_DEVICE_SCOPE_KEY_REQUIRED'
      );
    }
    await assertRegisteredDeviceScopeKey(requested);
    return resolveSiteKeyForScopeKey(requested);
  }
  if (requested) {
    throw new ApiError(
      400,
      'この端末では targetDeviceScopeKey を指定できません',
      undefined,
      'TARGET_DEVICE_SCOPE_KEY_FORBIDDEN'
    );
  }
  return resolveSiteKeyForScopeKey(actor);
}
