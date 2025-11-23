import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';

/**
 * システムヘルスチェックエンドポイント
 * GET /api/system/health
 */
export function registerSystemHealthRoute(app: FastifyInstance): void {
  app.get('/system/health', async (request, reply) => {
    const checks: Record<string, { status: 'ok' | 'error'; message?: string }> = {};

    // データベース接続チェック
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok' };
    } catch (error) {
      checks.database = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Database connection failed',
      };
    }

    // メモリ使用量チェック
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    };

    // ヒープ使用率が95%を超えている場合は警告（ラズパイ環境ではヒープが小さいため余裕を持たせる）
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (heapUsagePercent > 95) {
      checks.memory = {
        status: 'error',
        message: `High memory usage: ${heapUsagePercent.toFixed(1)}%`,
      };
    } else {
      checks.memory = {
        status: 'ok',
        ...(heapUsagePercent > 85
          ? { message: `Memory usage warning: ${heapUsagePercent.toFixed(1)}%` }
          : {}),
      };
    }

    // 全体的なステータスを決定
    const allOk = Object.values(checks).every((check) => check.status === 'ok');
    const statusCode = allOk ? 200 : 503;

    return reply.status(statusCode).send({
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      memory: memUsageMB,
      uptime: process.uptime(),
    });
  });
}

