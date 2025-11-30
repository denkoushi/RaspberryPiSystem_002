import pino from 'pino';
import { env } from '../config/env.js';

/**
 * アプリケーション全体で使用するロガー
 * サービス層やその他のビジネスロジックで使用
 * 
 * ログレベルは環境変数 `LOG_LEVEL` で制御可能:
 * - `debug`: すべてのログを出力（開発環境向け）
 * - `info`: 情報ログ以上を出力（デフォルト、開発環境）
 * - `warn`: 警告ログ以上を出力（デフォルト、本番環境）
 * - `error`: エラーログのみ出力（本番環境のトラブルシューティング時）
 */
export const logger = pino({ level: env.LOG_LEVEL });

