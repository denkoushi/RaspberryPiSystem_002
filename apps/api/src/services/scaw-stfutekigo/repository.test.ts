import { describe, expect, it, vi } from 'vitest';

import { acquireScawStfutekigoSnapshotLock } from './lock.js';
import { deleteScawStfutekigoStagingRows } from './repository.js';

describe('SCAW snapshot persistence helpers', () => {
  it('acquires the transaction-scoped PostgreSQL advisory lock', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);

    await acquireScawStfutekigoSnapshotLock({ $executeRaw: executeRaw } as never);

    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('deletes only the ingest run staging rows in bounded chunks', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'row-1' }, { id: 'row-2' }])
      .mockResolvedValueOnce([]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });

    const deleted = await deleteScawStfutekigoStagingRows(
      { csvDashboardRow: { findMany, deleteMany } } as never,
      'run-1',
      2
    );

    expect(deleted).toBe(2);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['row-1', 'row-2'] } } });
  });

  it('stops safely when a concurrent cleanup makes no deletion progress', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'row-1' }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });

    const deleted = await deleteScawStfutekigoStagingRows(
      { csvDashboardRow: { findMany, deleteMany } } as never,
      'run-1'
    );

    expect(deleted).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
