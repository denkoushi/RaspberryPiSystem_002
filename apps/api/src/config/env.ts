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
  SIGNAGE_RENDER_WIDTH: z.coerce.number().min(640).max(7680).default(1920),
  SIGNAGE_RENDER_HEIGHT: z.coerce.number().min(480).max(4320).default(1080),
  SIGNAGE_TIMEZONE: z.string().default('Asia/Tokyo'),
  NETWORK_MODE: z.enum(['local', 'maintenance']).default('local'),
  NETWORK_STATUS_OVERRIDE: z.enum(['internet_connected', 'local_network_only']).optional()
});

export const env = envSchema.parse(process.env);
