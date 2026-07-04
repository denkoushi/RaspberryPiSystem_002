import './load-dotenv.js';

import { z } from 'zod';

export const SECRET_MIN_LENGTH = 32;
export const WEAK_SECRET_PATTERNS = [
  'change-me',
  'dev-',
  'default',
  'example',
  'test-',
];

export const isWeakSecret = (secret: string): boolean => {
  const normalized = secret.trim().toLowerCase();
  if (normalized.length < SECRET_MIN_LENGTH) {
    return true;
  }
  return WEAK_SECRET_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const coreEnvShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/borrow_return'),
  /**
   * DATABASE_URL のクエリに未指定のときだけ付与する Prisma / pg プール既定（Pi など単一 API プロセス向けに控えめ）。
   * URL 側で `connection_limit` 等を明示していれば上書きしない。
   */
  DATABASE_PRISMA_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_PRISMA_POOL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(20),
  DATABASE_PRISMA_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(10),
  /**
   * GET /system/metrics の DB 集計（接続数・件数カウント）キャッシュ TTL（ミリ秒）。0 でキャッシュ無効（毎回計測）。
   */
  SYSTEM_METRICS_DB_AGGREGATES_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  /** GET /system/network-mode の連続 DNS チェック結果キャッシュ TTL（ミリ秒）。0 でキャッシュ無効。 */
  NETWORK_MODE_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  /** 機種名→FSEIBAN 解決インデックスの TTL（ミリ秒）。0 でキャッシュ無効。サイネージ定期レンダー向け既定60秒。 */
  PRODUCTION_SCHEDULE_MACHINE_NAME_FSEIBAN_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(600_000)
    .default(60_000),
  JWT_ACCESS_SECRET: z.string().default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().default('dev-refresh-secret-change-me'),
  TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default(process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
} as const;
