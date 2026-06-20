import { env } from '../../../config/env.js';

function readOrderSplitEnabledFromProcessEnv(): boolean | undefined {
  const raw = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
  if (raw == null) {
    return undefined;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return undefined;
}

/** 順位ボードの分割表示・分割操作が有効か。flag off では親行のみ・分割 API は 403。 */
export function isProductionScheduleOrderSplitEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') {
    const runtime = readOrderSplitEnabledFromProcessEnv();
    if (runtime !== undefined) {
      return runtime;
    }
  }
  return env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
}
