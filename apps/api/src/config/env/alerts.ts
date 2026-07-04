import { z } from 'zod';

export const alertsEnvShape = {
  // Alerts Dispatcher (Phase1: file alerts -> Slack)
  // NOTE:
  // - 既存システムを壊さないため、デフォルトは無効（明示的に有効化した場合のみ動作）
  ALERTS_DISPATCHER_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ),
  ALERTS_DISPATCHER_INTERVAL_SECONDS: z.coerce.number().min(5).max(3600).default(30),
  ALERTS_DISPATCHER_MAX_ATTEMPTS: z.coerce.number().min(1).max(20).default(5),
  ALERTS_DISPATCHER_RETRY_DELAY_SECONDS: z.coerce.number().min(5).max(3600).default(60),
  ALERTS_DISPATCHER_WEBHOOK_TIMEOUT_MS: z.coerce.number().min(500).max(30000).default(5000),

  // Optional JSON config path (e.g. /opt/RaspberryPiSystem_002/config/alerts.json)
  ALERTS_CONFIG_PATH: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),

  // Slack Webhooks (route-based). Empty string should be treated as undefined.
  ALERTS_SLACK_WEBHOOK_DEPLOY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  ALERTS_SLACK_WEBHOOK_OPS: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  ALERTS_SLACK_WEBHOOK_SUPPORT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  ALERTS_SLACK_WEBHOOK_SECURITY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),

  // Alerts DB Ingest (Phase2: file alerts -> DB)
  // NOTE:
  // - 既存システムを壊さないため、デフォルトは無効（明示的に有効化した場合のみ動作）
  ALERTS_DB_INGEST_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ),
  ALERTS_DB_INGEST_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(60),
  ALERTS_DB_INGEST_LIMIT: z.coerce.number().min(1).max(1000).default(50),
} as const;
