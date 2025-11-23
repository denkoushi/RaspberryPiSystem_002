import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';

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
        where: { status: 'ACTIVE' },
      });
      metrics.push(`# HELP employees_active_total Active employees`);
      metrics.push(`# TYPE employees_active_total gauge`);
      metrics.push(`employees_active_total ${employeeCount}`);

      // アイテム数
      const itemCount = await prisma.item.count({
        where: { status: { equals: 'ACTIVE' } },
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

