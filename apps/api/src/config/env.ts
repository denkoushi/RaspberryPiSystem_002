import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/borrow_return'),
  JWT_ACCESS_SECRET: z.string().default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().default('dev-refresh-secret-change-me'),
  TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default(process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  SIGNAGE_RENDER_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(30),
  SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(30),
  SIGNAGE_RENDER_WIDTH: z.coerce.number().min(640).max(7680).default(1920),
  SIGNAGE_RENDER_HEIGHT: z.coerce.number().min(480).max(4320).default(1080),
  SIGNAGE_TIMEZONE: z.string().default('Asia/Tokyo'),
  NETWORK_MODE: z.enum(['local', 'maintenance']).default('local'),
  NETWORK_STATUS_OVERRIDE: z.enum(['internet_connected', 'local_network_only']).optional(),
  // NOTE:
  // docker-compose.server.yml では `${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}` により
  // 未設定時でも空文字が注入されるため、空文字は undefined として扱う。
  SLACK_KIOSK_SUPPORT_WEBHOOK_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),

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

  // Gmail trash cleanup (processed label in trash -> hard delete)
  GMAIL_TRASH_CLEANUP_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ),
  GMAIL_TRASH_CLEANUP_CRON: z.string().default('0 3 * * *'),
  GMAIL_TRASH_CLEANUP_LABEL: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).default('rps_processed')
  ),
  GMAIL_TRASH_CLEANUP_MIN_AGE: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).default('older_than:30m')
  )
});

export const env = envSchema.parse(process.env);
