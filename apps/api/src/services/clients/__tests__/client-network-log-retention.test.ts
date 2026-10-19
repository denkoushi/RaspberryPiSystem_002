import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { NETWORK_LOG_BATCH_SIZE, NETWORK_LOG_MAX_BATCHES, pruneClientNetworkLogs } from '../client-network-log-retention.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { clientLog: { findMany: vi.fn(), deleteMany: vi.fn() } } }));
const now = new Date('2026-10-09T00:00:00Z');
const cutoff = new Date('2026-09-09T00:00:00Z');
const categoryPredicate = { OR: [
  { context: { path: ['category'], equals: 'network_health' } },
  { context: { path: ['category'], equals: 'kiosk_net_stats' } }
] };

describe('network ClientLog retention', () => {
  beforeEach(() => vi.resetAllMocks());

  it('selects and deletes only old target categories, repeating the predicate on deletion', async () => {
    const rows = [
      { id: 'old-network', createdAt: new Date('2026-09-08'), context: { category: 'network_health' } },
      { id: 'old-kiosk-net', createdAt: new Date('2026-09-08'), context: { category: 'kiosk_net_stats' } },
      { id: 'boundary', createdAt: cutoff, context: { category: 'network_health' } },
      { id: 'new-network', createdAt: now, context: { category: 'network_health' } },
      { id: 'old-ui', createdAt: new Date('2020-01-01'), context: { category: 'kiosk_ui_error' } },
      { id: 'old-storage', createdAt: new Date('2020-01-01'), context: { category: 'storage_health' } },
      { id: 'old-legacy', createdAt: new Date('2020-01-01'), context: null }
    ];
    const predicate = (row: typeof rows[number]) => row.createdAt < cutoff && ['network_health', 'kiosk_net_stats'].includes(row.context?.category ?? '');
    vi.mocked(prisma.clientLog.findMany).mockImplementation(async (args) => {
      expect(args).toEqual({ where: { createdAt: { lt: cutoff }, ...categoryPredicate }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: NETWORK_LOG_BATCH_SIZE });
      return rows.filter(predicate).map(({ id }) => ({ id })) as never;
    });
    vi.mocked(prisma.clientLog.deleteMany).mockImplementation(async (args) => {
      expect(args).toEqual({ where: { createdAt: { lt: cutoff }, ...categoryPredicate, id: { in: ['old-network', 'old-kiosk-net'] } } });
      const selected = rows.filter(predicate);
      for (const row of selected) rows.splice(rows.indexOf(row), 1);
      return { count: selected.length };
    });
    expect(await pruneClientNetworkLogs(now)).toBe(2);
    expect(rows.map((row) => row.id)).toEqual(['boundary', 'new-network', 'old-ui', 'old-storage', 'old-legacy']);
  });

  it('does not delete when nothing matches', async () => {
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([]);
    expect(await pruneClientNetworkLogs(now)).toBe(0);
    expect(prisma.clientLog.deleteMany).not.toHaveBeenCalled();
  });

  it('bounds full batches and total work', async () => {
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue(Array.from({ length: NETWORK_LOG_BATCH_SIZE }, (_, i) => ({ id: String(i) })) as never);
    vi.mocked(prisma.clientLog.deleteMany).mockResolvedValue({ count: NETWORK_LOG_BATCH_SIZE });
    expect(await pruneClientNetworkLogs(now)).toBe(NETWORK_LOG_BATCH_SIZE * NETWORK_LOG_MAX_BATCHES);
    expect(prisma.clientLog.findMany).toHaveBeenCalledTimes(NETWORK_LOG_MAX_BATCHES);
    expect(prisma.clientLog.deleteMany).toHaveBeenCalledTimes(NETWORK_LOG_MAX_BATCHES);
  });

  it('stops after a short batch and propagates DB failure to the scheduler', async () => {
    vi.mocked(prisma.clientLog.findMany).mockRejectedValue(new Error('DB unavailable'));
    await expect(pruneClientNetworkLogs(now)).rejects.toThrow('DB unavailable');
    expect(prisma.clientLog.deleteMany).not.toHaveBeenCalled();
  });
});
