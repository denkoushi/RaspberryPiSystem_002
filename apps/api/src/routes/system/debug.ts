import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';

/**
 * デバッグ用エンドポイント
 * GET /api/system/debug/logs - 最近のエラーログを取得（管理者のみ）
 * GET /api/system/debug/requests - 最近のリクエストログを取得（管理者のみ）
 */
export function registerDebugRoutes(app: FastifyInstance): void {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // 簡易的なログストア（メモリ内、最大100件）
  const errorLogs: Array<{
    timestamp: string;
    level: string;
    message: string;
    data: unknown;
  }> = [];

  const requestLogs: Array<{
    timestamp: string;
    method: string;
    url: string;
    statusCode: number;
    responseTime: number;
  }> = [];

  // ログを記録するためのフック
  app.addHook('onResponse', async (request, reply) => {
    const statusCode = reply.statusCode;
    const responseTime = reply.getResponseTime();
    
    // エラーログを記録（429, 404, 500など）
    if (statusCode >= 400) {
      errorLogs.push({
        timestamp: new Date().toISOString(),
        level: statusCode >= 500 ? 'error' : 'warn',
        message: `HTTP ${statusCode}`,
        data: {
          method: request.method,
          url: request.url,
          statusCode,
          responseTime,
          ip: request.ip,
          headers: {
            'user-agent': request.headers['user-agent'],
            'x-forwarded-for': request.headers['x-forwarded-for'],
          },
        },
      });
      
      // 最大100件まで保持
      if (errorLogs.length > 100) {
        errorLogs.shift();
      }
    }
    
    // リクエストログを記録
    requestLogs.push({
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      statusCode,
      responseTime,
    });
    
    // 最大100件まで保持
    if (requestLogs.length > 100) {
      requestLogs.shift();
    }
  });

  app.get<{ Querystring: { limit?: string; level?: string } }>(
    '/system/debug/logs',
    { preHandler: mustBeAdmin },
    async (request) => {
      const limit = Number.parseInt(request.query?.limit || '50') || 50;
      const level = request.query?.level;
    
    let logs = errorLogs;
    if (level) {
      logs = errorLogs.filter(log => log.level === level);
    }
    
      return {
        logs: logs.slice(-limit),
        total: logs.length,
      };
    }
  );

  app.get<{ Querystring: { limit?: string; statusCode?: string } }>(
    '/system/debug/requests',
    { preHandler: mustBeAdmin },
    async (request) => {
      const limit = Number.parseInt(request.query?.limit || '50') || 50;
      const statusCode = request.query?.statusCode 
        ? Number.parseInt(request.query.statusCode) 
        : undefined;
    
    let logs = requestLogs;
    if (statusCode) {
      logs = requestLogs.filter(log => log.statusCode === statusCode);
    }
    
      return {
        requests: logs.slice(-limit),
        total: logs.length,
      };
    }
  );
}

