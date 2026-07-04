import { z } from 'zod';

export const kioskFlagsEnvShape = {
  RATE_LIMIT_REDIS_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  KIOSK_SUPPORT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(3),
  KIOSK_SUPPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60 * 1000),
  KIOSK_POWER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(1),
  KIOSK_POWER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60 * 1000),
  ACTUAL_HOURS_SHARED_FALLBACK_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ),
  // 手動順番を deviceScopeKey 正とし、Mac 代理は targetDeviceScopeKey 必須にする v2 契約（無効時は従来の targetLocation 動作）
  KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ).transform((v) => v === 'true'),
  /** 順位ボードの生産指示分割（初回: 表示・数量・納期・手動順番）。無効時は親行のみ・分割 API は 403。 */
  KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ).transform((v) => v === 'true'),
} as const;
