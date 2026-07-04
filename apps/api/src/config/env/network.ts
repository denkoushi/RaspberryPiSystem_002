import { z } from 'zod';

export const networkEnvShape = {
  NETWORK_MODE: z.enum(['local', 'maintenance']).default('local'),
  NETWORK_STATUS_OVERRIDE: z.enum(['internet_connected', 'local_network_only']).optional(),
  // NOTE:
  // docker-compose.server.yml では `${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}` により
  // 未設定時でも空文字が注入されるため、空文字は undefined として扱う。
  SLACK_KIOSK_SUPPORT_WEBHOOK_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
} as const;
