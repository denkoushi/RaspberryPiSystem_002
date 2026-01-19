import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * リクエスト/レスポンスの詳細ログを記録するプラグイン
 * 429エラーや404エラーの原因特定に役立つ
 */
export function registerRequestLogger(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.log.info({
      req: {
        id: request.id,
        method: request.method,
        url: request.url,
        headers: {
          'user-agent': request.headers['user-agent'],
          'x-forwarded-for': request.headers['x-forwarded-for'],
          'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
          'authorization': request.headers['authorization'] ? '[REDACTED]' : undefined,
        },
        ip: request.ip,
        hostname: request.hostname,
      },
    }, 'incoming request');
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = reply.statusCode;
    const responseTime = reply.getResponseTime();
    
    // 429エラーや404エラーの場合は詳細ログを出力
    if (statusCode === 429 || statusCode === 404) {
      request.log.warn({
        req: {
          id: request.id,
          method: request.method,
          url: request.url,
          headers: {
            'user-agent': request.headers['user-agent'],
            'x-forwarded-for': request.headers['x-forwarded-for'],
            'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
          },
          ip: request.ip,
          hostname: request.hostname,
        },
        res: {
          statusCode,
          responseTime,
        },
      }, `HTTP ${statusCode} error`);
    } else {
      request.log.info({
        req: {
          id: request.id,
          method: request.method,
          url: request.url,
        },
        res: {
          statusCode,
          responseTime,
        },
      }, 'request completed');
    }
  });
}

