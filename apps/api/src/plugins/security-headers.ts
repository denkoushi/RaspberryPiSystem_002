import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';

/**
 * セキュリティヘッダープラグインを登録
 * XSS、クリックジャッキング、MIMEタイプスニッフィングなどの対策を追加
 */
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // TailwindCSSのためunsafe-inlineを許可
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'], // WebSocket接続を許可
      },
    },
    crossOriginEmbedderPolicy: false, // WebSocket接続のため無効化
  });
}

