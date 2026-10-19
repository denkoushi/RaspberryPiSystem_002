import type { Prisma } from '@prisma/client';

export const NETWORK_LOG_RETENTION_DAYS = 30;
export const NETWORK_LOG_BATCH_SIZE = 5000;
export const NETWORK_LOG_MAX_BATCHES = 10;

export async function pruneClientNetworkLogs(now = new Date()): Promise<number> {
  // Keep DB initialization out of module loading (including DB-less tests).
  const { prisma } = await import('../../lib/prisma.js');
  const where: Prisma.ClientLogWhereInput = {
    createdAt: { lt: new Date(now.getTime() - NETWORK_LOG_RETENTION_DAYS * 86400000) },
    OR: ['network_health', 'kiosk_net_stats'].map((category) => ({
      context: { path: ['category'], equals: category }
    }))
  };
  let deleted = 0;
  for (let batch = 0; batch < NETWORK_LOG_MAX_BATCHES; batch += 1) {
    const rows = await prisma.clientLog.findMany({
      where, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: NETWORK_LOG_BATCH_SIZE
    });
    if (!rows.length) break;
    // Repeat the category/time predicate at deletion, in addition to the selected IDs.
    const result = await prisma.clientLog.deleteMany({ where: { ...where, id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (rows.length < NETWORK_LOG_BATCH_SIZE) break;
  }
  return deleted;
}
