import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { ItemStatus, EmployeeStatus } from '@prisma/client';
import { snapshotEventLoopObservability } from '../../services/system/event-loop-observability.js';

/**
 * システムメトリクスエンドポイント
 * GET /api/system/metrics
 * Prometheus形式のメトリクスを返す
 */
export function registerMetricsRoute(app: FastifyInstance): void {
  app.get('/system/metrics', async (request, reply) => {
    const metrics: string[] = [];

    try {
      // データベース接続数
      const dbConnections = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) as count FROM pg_stat_activity WHERE datname = 'borrow_return'
      `;
      metrics.push(`# HELP db_connections_total Current database connections`);
      metrics.push(`# TYPE db_connections_total gauge`);
      metrics.push(`db_connections_total ${dbConnections[0]?.count || 0}`);

      // アクティブな貸出数
      const activeLoans = await prisma.loan.count({
        where: { returnedAt: null },
      });
      metrics.push(`# HELP loans_active_total Current active loans`);
      metrics.push(`# TYPE loans_active_total gauge`);
      metrics.push(`loans_active_total ${activeLoans}`);

      // 従業員数
      const employeeCount = await prisma.employee.count({
        where: { status: EmployeeStatus.ACTIVE },
      });
      metrics.push(`# HELP employees_active_total Active employees`);
      metrics.push(`# TYPE employees_active_total gauge`);
      metrics.push(`employees_active_total ${employeeCount}`);

      // アイテム数（AVAILABLEとIN_USEをカウント）
      const itemCount = await prisma.item.count({
        where: {
          status: {
            in: [ItemStatus.AVAILABLE, ItemStatus.IN_USE],
          },
        },
      });
      metrics.push(`# HELP items_active_total Active items`);
      metrics.push(`# TYPE items_active_total gauge`);
      metrics.push(`items_active_total ${itemCount}`);

      // メモリ使用量
      const memUsage = process.memoryUsage();
      metrics.push(`# HELP process_memory_bytes Process memory usage in bytes`);
      metrics.push(`# TYPE process_memory_bytes gauge`);
      metrics.push(`process_memory_bytes{type="rss"} ${memUsage.rss}`);
      metrics.push(`process_memory_bytes{type="heapTotal"} ${memUsage.heapTotal}`);
      metrics.push(`process_memory_bytes{type="heapUsed"} ${memUsage.heapUsed}`);
      metrics.push(`process_memory_bytes{type="external"} ${memUsage.external}`);

      // イベントループ観測（TTFB遅延の切り分け用）
      const eventLoop = snapshotEventLoopObservability();
      metrics.push(`# HELP nodejs_event_loop_delay_milliseconds Event loop delay histogram summary in milliseconds`);
      metrics.push(`# TYPE nodejs_event_loop_delay_milliseconds gauge`);
      metrics.push(`nodejs_event_loop_delay_milliseconds{quantile="p50"} ${eventLoop.eventLoopDelayMs.p50}`);
      metrics.push(`nodejs_event_loop_delay_milliseconds{quantile="p90"} ${eventLoop.eventLoopDelayMs.p90}`);
      metrics.push(`nodejs_event_loop_delay_milliseconds{quantile="p99"} ${eventLoop.eventLoopDelayMs.p99}`);
      metrics.push(`nodejs_event_loop_delay_milliseconds{quantile="mean"} ${eventLoop.eventLoopDelayMs.mean}`);
      metrics.push(`nodejs_event_loop_delay_milliseconds{quantile="max"} ${eventLoop.eventLoopDelayMs.max}`);
      metrics.push(`# HELP nodejs_event_loop_utilization_ratio Event loop utilization ratio (0-1)`);
      metrics.push(`# TYPE nodejs_event_loop_utilization_ratio gauge`);
      metrics.push(`nodejs_event_loop_utilization_ratio ${eventLoop.elu.utilization}`);
      metrics.push(`# HELP nodejs_event_loop_active_milliseconds Active event loop time in milliseconds`);
      metrics.push(`# TYPE nodejs_event_loop_active_milliseconds gauge`);
      metrics.push(`nodejs_event_loop_active_milliseconds ${eventLoop.elu.activeMs}`);
      metrics.push(`# HELP nodejs_event_loop_idle_milliseconds Idle event loop time in milliseconds`);
      metrics.push(`# TYPE nodejs_event_loop_idle_milliseconds gauge`);
      metrics.push(`nodejs_event_loop_idle_milliseconds ${eventLoop.elu.idleMs}`);

      // サイネージ worker 観測（自動復帰ロジックは持たず、運用判断材料のみ）
      const signageTelemetry = app.signageRenderScheduler.getTelemetrySnapshot();
      metrics.push(`# HELP signage_render_scheduler_running Signage render scheduler running state`);
      metrics.push(`# TYPE signage_render_scheduler_running gauge`);
      metrics.push(`signage_render_scheduler_running ${signageTelemetry.isRunning ? 1 : 0}`);
      metrics.push(`# HELP signage_render_in_progress Signage render in-progress state`);
      metrics.push(`# TYPE signage_render_in_progress gauge`);
      metrics.push(`signage_render_in_progress ${signageTelemetry.isRendering ? 1 : 0}`);
      metrics.push(`# HELP signage_render_skip_total Number of skipped render attempts due to overlap`);
      metrics.push(`# TYPE signage_render_skip_total counter`);
      metrics.push(`signage_render_skip_total ${signageTelemetry.skipCount}`);
      metrics.push(`# HELP signage_render_worker_pid Worker PID (0 when not running as worker process)`);
      metrics.push(`# TYPE signage_render_worker_pid gauge`);
      metrics.push(`signage_render_worker_pid ${signageTelemetry.workerPid ?? 0}`);
      metrics.push(`# HELP signage_render_runner_info Signage render runner mode`);
      metrics.push(`# TYPE signage_render_runner_info gauge`);
      metrics.push(`signage_render_runner_info{runner="${signageTelemetry.runner}"} 1`);
      if (signageTelemetry.lastRenderDurationMs !== null) {
        metrics.push(`# HELP signage_render_last_duration_milliseconds Last render duration`);
        metrics.push(`# TYPE signage_render_last_duration_milliseconds gauge`);
        metrics.push(`signage_render_last_duration_milliseconds ${signageTelemetry.lastRenderDurationMs}`);
      }

      // プロセス起動時間
      metrics.push(`# HELP process_uptime_seconds Process uptime in seconds`);
      metrics.push(`# TYPE process_uptime_seconds gauge`);
      metrics.push(`process_uptime_seconds ${process.uptime()}`);

      // Node.jsバージョン
      metrics.push(`# HELP nodejs_version_info Node.js version`);
      metrics.push(`# TYPE nodejs_version_info gauge`);
      metrics.push(`nodejs_version_info{version="${process.version}"} 1`);

      return reply.type('text/plain').send(metrics.join('\n') + '\n');
    } catch (error) {
      request.log.error({ err: error }, 'Failed to collect metrics');
      return reply.status(500).send({ error: 'Failed to collect metrics' });
    }
  });
}

