import { describe, expect, it, vi } from 'vitest';
import { BackupScheduler } from '../backup-scheduler';

type BackupListEntry = {
  path?: string | null;
  modifiedAt?: Date | string | null;
};

const markHistoryAsDeletedByPath = vi.fn().mockResolvedValue(1);
const markExcessHistoryAsDeleted = vi.fn().mockResolvedValue(1);

vi.mock('../backup-history.service', () => ({
  BackupHistoryService: vi.fn().mockImplementation(() => ({
    markHistoryAsDeletedByPath,
    markExcessHistoryAsDeleted
  }))
}));

describe('BackupScheduler.cleanupOldBackups', () => {
  it('deletes oldest backups when only maxBackups is set', async () => {
    const scheduler = new BackupScheduler();
    const backups: BackupListEntry[] = [
      { path: '/backups/database/2026-01-01/borrow_return.sql.gz', modifiedAt: new Date('2026-01-01T00:00:00Z') },
      { path: '/backups/database/2026-01-02/borrow_return.sql.gz', modifiedAt: new Date('2026-01-02T00:00:00Z') },
      { path: '/backups/database/2026-01-03/borrow_return.sql.gz', modifiedAt: new Date('2026-01-03T00:00:00Z') }
    ];

    const backupService = {
      listBackups: vi.fn().mockResolvedValue(backups),
      deleteBackup: vi.fn().mockResolvedValue(undefined)
    };

    await (scheduler as unknown as { cleanupOldBackups: (...args: unknown[]) => Promise<void> }).cleanupOldBackups(
      backupService,
      { maxBackups: 2 },
      'database',
      undefined,
      'database',
      'borrow_return'
    );

    expect(backupService.deleteBackup).toHaveBeenCalledTimes(1);
    expect(backupService.deleteBackup).toHaveBeenCalledWith('/backups/database/2026-01-01/borrow_return.sql.gz');
    expect(markHistoryAsDeletedByPath).toHaveBeenCalledTimes(1);
    expect(markExcessHistoryAsDeleted).toHaveBeenCalledTimes(1);
  });

  it('matches database backups with .sql.gz suffix', async () => {
    const scheduler = new BackupScheduler();
    const backups: BackupListEntry[] = [
      { path: '/backups/database/2026-01-01/borrow_return.sql.gz', modifiedAt: new Date('2026-01-01T00:00:00Z') },
      { path: '/backups/database/2026-01-02/borrow_return.sql.gz', modifiedAt: new Date('2026-01-02T00:00:00Z') }
    ];

    const backupService = {
      listBackups: vi.fn().mockResolvedValue(backups),
      deleteBackup: vi.fn().mockResolvedValue(undefined)
    };

    await (scheduler as unknown as { cleanupOldBackups: (...args: unknown[]) => Promise<void> }).cleanupOldBackups(
      backupService,
      { maxBackups: 1 },
      'database',
      'borrow_return',
      'database',
      'postgresql://postgres:postgres@localhost:5432/borrow_return'
    );

    expect(backupService.deleteBackup).toHaveBeenCalledWith('/backups/database/2026-01-01/borrow_return.sql.gz');
  });

  it('matches csv backups with .csv suffix', async () => {
    const scheduler = new BackupScheduler();
    const backups: BackupListEntry[] = [
      { path: '/backups/csv/2026-01-01/employees.csv', modifiedAt: new Date('2026-01-01T00:00:00Z') },
      { path: '/backups/csv/2026-01-02/employees.csv', modifiedAt: new Date('2026-01-02T00:00:00Z') }
    ];

    const backupService = {
      listBackups: vi.fn().mockResolvedValue(backups),
      deleteBackup: vi.fn().mockResolvedValue(undefined)
    };

    await (scheduler as unknown as { cleanupOldBackups: (...args: unknown[]) => Promise<void> }).cleanupOldBackups(
      backupService,
      { maxBackups: 1 },
      'csv',
      'employees',
      'csv',
      'employees'
    );

    expect(backupService.deleteBackup).toHaveBeenCalledWith('/backups/csv/2026-01-01/employees.csv');
  });
});
