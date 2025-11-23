import pino from 'pino';
import { env } from '../config/env.js';

/**
 * アプリケーション全体で使用するロガー
 * サービス層やその他のビジネスロジックで使用
 */
export const logger = pino({ level: env.LOG_LEVEL });

