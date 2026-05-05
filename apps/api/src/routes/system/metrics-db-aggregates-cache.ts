import type { PrismaClient } from '@prisma/client';
import { ItemStatus, EmployeeStatus } from '@prisma/client';

export type MetricsDbAggregates = {
  dbConnections: bigint;
  activeLoans: number;
  employeeCount: number;
  itemCount: number;
};

/** Prisma 複数クエリのメモリキャッシュ（高頻度 scrape 向け） */
let aggregatesCache: { computedAt: number; data: MetricsDbAggregates } | null = null;

export async function resolveMetricsDbAggregates(
  prisma: PrismaClient,
  ttlMs: number
): Promise<MetricsDbAggregates> {
  const now = Date.now();
  if (ttlMs > 0 && aggregatesCache && now - aggregatesCache.computedAt < ttlMs) {
    return aggregatesCache.data;
  }

  const [dbConnections, activeLoans, employeeCount, itemCount] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) as count FROM pg_stat_activity WHERE datname = 'borrow_return'
    `,
    prisma.loan.count({
      where: { returnedAt: null }
    }),
    prisma.employee.count({
      where: { status: EmployeeStatus.ACTIVE }
    }),
    prisma.item.count({
      where: {
        status: {
          in: [ItemStatus.AVAILABLE, ItemStatus.IN_USE]
        }
      }
    })
  ]);

  const data: MetricsDbAggregates = {
    dbConnections: dbConnections[0]?.count ?? 0n,
    activeLoans,
    employeeCount,
    itemCount
  };

  if (ttlMs > 0) {
    aggregatesCache = { computedAt: now, data };
  }

  return data;
}
