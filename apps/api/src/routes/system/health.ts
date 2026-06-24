import type { FastifyInstance } from 'fastify';
import { getHeapStatistics } from 'node:v8';
import { prisma } from '../../lib/prisma.js';
import { probePlaywrightChromiumAvailability } from '../../services/signage/loan-grid/playwright/playwright-chromium-availability.js';
import {
  evaluateEventLoopHealth,
  snapshotEventLoopObservability,
} from '../../services/system/event-loop-observability.js';

type HealthCheckStatus = 'ok' | 'error' | 'warning';

const MEMORY_WARNING_PERCENT = 85;
const MEMORY_ERROR_PERCENT = 95;

/**
 * システムヘルスチェックエンドポイント
 * GET /api/system/health
 */
export function registerSystemHealthRoute(app: FastifyInstance): void {
  app.get('/system/health', async (request, reply) => {
    const checks: Record<string, { status: HealthCheckStatus; message?: string }> = {};

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
    const heapLimitBytes = getHeapStatistics().heap_size_limit;
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapLimit: Math.round(heapLimitBytes / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    };

    // heapTotal は V8 が現在確保している枠なので起動直後でも高率になりやすい。
    // ヘルス判定は実際の上限(heap_size_limit)に対する使用率で行う。
    const heapLimitUsagePercent = heapLimitBytes > 0 ? (memUsage.heapUsed / heapLimitBytes) * 100 : 0;
    const heapAllocationUsagePercent =
      memUsage.heapTotal > 0 ? (memUsage.heapUsed / memUsage.heapTotal) * 100 : 0;
    if (heapLimitUsagePercent > MEMORY_ERROR_PERCENT) {
      checks.memory = {
        status: 'error',
        message: `High heap usage: ${heapLimitUsagePercent.toFixed(1)}% of limit (${memUsageMB.heapUsed}MB/${memUsageMB.heapLimit}MB)`,
      };
    } else {
      const memoryMessage =
        heapLimitUsagePercent > MEMORY_WARNING_PERCENT
          ? `Heap usage warning: ${heapLimitUsagePercent.toFixed(1)}% of limit (${memUsageMB.heapUsed}MB/${memUsageMB.heapLimit}MB)`
          : heapAllocationUsagePercent > MEMORY_WARNING_PERCENT
            ? `Allocated heap usage warning: ${heapAllocationUsagePercent.toFixed(1)}% (${memUsageMB.heapUsed}MB/${memUsageMB.heapTotal}MB allocated, ${heapLimitUsagePercent.toFixed(1)}% of limit)`
            : undefined;
      checks.memory = {
        status: 'ok',
        ...(memoryMessage ? { message: memoryMessage } : {}),
      };
    }

    // イベントループ遅延チェック（degraded判定は閾値超過時のみ）
    const eventLoop = snapshotEventLoopObservability();
    const eventLoopHealth = evaluateEventLoopHealth(eventLoop);
    checks.eventLoop = eventLoopHealth;

    const playwrightAvailability = probePlaywrightChromiumAvailability();
    checks.playwright = playwrightAvailability.available
      ? { status: 'ok' }
      : { status: 'warning', message: playwrightAvailability.message };

    // 全体的なステータスを決定（warning のみでは degraded にしない）
    const hasError = Object.values(checks).some((check) => check.status === 'error');
    const statusCode = hasError ? 503 : 200;

    return reply.status(statusCode).send({
      status: hasError ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      checks,
      memory: memUsageMB,
      eventLoop,
      uptime: process.uptime(),
    });
  });
}
