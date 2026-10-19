import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupHistoryService } from '../backup-history.service.js';

const { updateManyMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn()
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { backupHistory: { updateMany: updateManyMock } }
}));

describe('BackupHistoryService.markHistoryAsDeletedByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it.each([
    {
      backupPath: '/backups/csv/2026-08-22T20-10-00-000Z/employees.csv',
      candidates: ['/backups/csv/2026-08-22T20-10-00-000Z/employees.csv', 'csv/2026-08-22T20-10-00-000Z/employees.csv']
    },
    {
      backupPath: 'csv/2026-08-22T20-10-00-000Z/employees.csv',
      candidates: ['csv/2026-08-22T20-10-00-000Z/employees.csv']
    },
    {
      backupPath: '/backups/weekly/database/2026-08-22T20-10-00-000Z-weekly/borrow_return.sql.gz',
      candidates: ['/backups/weekly/database/2026-08-22T20-10-00-000Z-weekly/borrow_return.sql.gz', 'database/2026-08-22T20-10-00-000Z-weekly/borrow_return.sql.gz']
    },
    {
      backupPath: 'database/2026-08-22T20-10-00-000Z-weekly/borrow_return.sql.gz',
      candidates: ['database/2026-08-22T20-10-00-000Z-weekly/borrow_return.sql.gz']
    }
  ])('matches candidates for $backupPath', async ({ backupPath, candidates }) => {
    const result = await new BackupHistoryService().markHistoryAsDeletedByPath(backupPath);

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { backupPath: { in: candidates }, fileStatus: 'EXISTS' },
      data: { fileStatus: 'DELETED' }
    });
    expect(result).toBe(1);
  });
});
