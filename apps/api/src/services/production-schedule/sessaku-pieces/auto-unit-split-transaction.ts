import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../lib/errors.js';

export type AutoUnitSplitMetrics = { writtenRowCount: number; lockStarted?: number; lockHeldMs: number; yieldReason: string | null; candidateMs?: number; candidateSqlCount?: number; yieldCheckCount?: number; yieldCheckMs?: number };
export const autoUnitSplitMetrics = new AsyncLocalStorage<AutoUnitSplitMetrics>();

export function isAutoUnitSplitYield(error: unknown): boolean {
  return error instanceof ApiError && ['AUTO_UNIT_SPLIT_YIELD', 'AUTO_UNIT_SPLIT_BUSY'].includes(error.code ?? '');
}

/** Check using the owning connection: pg_blocking_pids also sees advisory/row lock waiters. */
export function cooperativeAutoUnitSplitTransaction(raw: Prisma.TransactionClient, metrics: AutoUnitSplitMetrics) {
  let lastCheck = -Infinity;
  const check = async (force = false) => {
    if (!force && performance.now() - lastCheck < 25) return;
    const started = performance.now();
    metrics.yieldCheckCount = (metrics.yieldCheckCount ?? 0) + 1;
    try {
      const [row] = await raw.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_locks waiter
        WHERE NOT waiter.granted AND waiter.pid <> pg_backend_pid()
          AND pg_backend_pid() = ANY(pg_blocking_pids(waiter.pid))) AS waiting`;
      lastCheck = performance.now();
      if (row.waiting) throw new ApiError(409, '自動分割を保存操作に譲ります', undefined, 'AUTO_UNIT_SPLIT_YIELD');
    } finally {
      metrics.yieldCheckMs = (metrics.yieldCheckMs ?? 0) + performance.now() - started;
    }
  };
  const guard = <T extends object>(target: T): T => new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property);
      if (typeof value === 'function') return async (...args: unknown[]) => {
        await check();
        const result = await Reflect.apply(value, object, args);
        const method = String(property);
        if (/^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/.test(method)) {
          metrics.writtenRowCount += method.endsWith('Many') ? (result as { count: number }).count : 1;
        } else if (method === '$executeRaw' && typeof result === 'number' && result > 0
          && /^\s*(INSERT|UPDATE|DELETE)\b/i.test((args[0] as { sql?: string }).sql ?? '')) {
          metrics.writtenRowCount += result;
        }
        await check();
        return result;
      };
      return value && typeof value === 'object' ? guard(value) : value;
    }
  });
  return { tx: guard(raw), check };
}
