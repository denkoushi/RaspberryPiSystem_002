import { getHeapStatistics } from 'node:v8';

import { prisma } from '../../lib/prisma.js';
import { probePlaywrightChromiumAvailability } from '../signage/loan-grid/playwright/playwright-chromium-availability.js';
import {
  evaluateEventLoopHealth,
  snapshotEventLoopObservability,
} from './event-loop-observability.js';

export type HealthCheckStatus = 'ok' | 'error' | 'warning';

export type SystemHealthDetail = {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: Record<string, { status: HealthCheckStatus; message?: string }>;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    heapLimit: number;
    external: number;
  };
  eventLoop: ReturnType<typeof snapshotEventLoopObservability>;
  uptime: number;
};

export type SystemHealthResult = {
  statusCode: 200 | 503;
  detail: SystemHealthDetail;
};

const MEMORY_WARNING_PERCENT = 85;
const MEMORY_ERROR_PERCENT = 95;

export async function collectSystemHealth(): Promise<SystemHealthResult> {
  const checks: SystemHealthDetail['checks'] = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok' };
  } catch (error) {
    checks.database = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Database connection failed',
    };
  }

  const memUsage = process.memoryUsage();
  const heapLimitBytes = getHeapStatistics().heap_size_limit;
  const memory = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapLimit: Math.round(heapLimitBytes / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
  };

  const heapLimitUsagePercent = heapLimitBytes > 0 ? (memUsage.heapUsed / heapLimitBytes) * 100 : 0;
  const heapAllocationUsagePercent =
    memUsage.heapTotal > 0 ? (memUsage.heapUsed / memUsage.heapTotal) * 100 : 0;

  if (heapLimitUsagePercent > MEMORY_ERROR_PERCENT) {
    checks.memory = {
      status: 'error',
      message: `High heap usage: ${heapLimitUsagePercent.toFixed(1)}% of limit (${memory.heapUsed}MB/${memory.heapLimit}MB)`,
    };
  } else {
    const memoryMessage =
      heapLimitUsagePercent > MEMORY_WARNING_PERCENT
        ? `Heap usage warning: ${heapLimitUsagePercent.toFixed(1)}% of limit (${memory.heapUsed}MB/${memory.heapLimit}MB)`
        : heapAllocationUsagePercent > MEMORY_WARNING_PERCENT
          ? `Allocated heap usage warning: ${heapAllocationUsagePercent.toFixed(1)}% (${memory.heapUsed}MB/${memory.heapTotal}MB allocated, ${heapLimitUsagePercent.toFixed(1)}% of limit)`
          : undefined;
    checks.memory = {
      status: 'ok',
      ...(memoryMessage ? { message: memoryMessage } : {}),
    };
  }

  const eventLoop = snapshotEventLoopObservability();
  checks.eventLoop = evaluateEventLoopHealth(eventLoop);

  const playwrightAvailability = probePlaywrightChromiumAvailability();
  checks.playwright = playwrightAvailability.available
    ? { status: 'ok' }
    : { status: 'warning', message: playwrightAvailability.message };

  const hasError = Object.values(checks).some((check) => check.status === 'error');
  const statusCode = hasError ? 503 : 200;

  return {
    statusCode,
    detail: {
      status: hasError ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      checks,
      memory,
      eventLoop,
      uptime: process.uptime(),
    },
  };
}
