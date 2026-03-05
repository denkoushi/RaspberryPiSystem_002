import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverAndRetryBackupOnInsufficientSpace } from '../backup-space-recovery.service.js';

const { markHistoryAsDeletedByPathMock } = vi.hoisted(() => ({
  markHistoryAsDeletedByPathMock: vi.fn().mockResolvedValue(1)
}));

vi.mock('../backup-history.service.js', () => ({
  BackupHistoryService: vi.fn().mockImplementation(() => ({
    markHistoryAsDeletedByPath: markHistoryAsDeletedByPathMock
  }))
}));

describe('backup-space-recovery.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unrecovered when error is not insufficient-space', async () => {
    const backupService = {
      listBackups: vi.fn(),
      deleteBackup: vi.fn(),
      backup: vi.fn()
    } as any;

    const result = await recoverAndRetryBackupOnInsufficientSpace({
      backupService,
      target: {} as any,
      errorMessage: 'network timeout'
    });

    expect(result.recovered).toBe(false);
    expect(result.deletedPaths).toEqual([]);
    expect(backupService.listBackups).not.toHaveBeenCalled();
  });

  it('deletes oldest backups and retries until backup succeeds', async () => {
    const backupService = {
      listBackups: vi.fn().mockResolvedValue([
        { path: 'database/2024-01-01/borrow_return.sql.gz', modifiedAt: new Date('2024-01-01T00:00:00Z'), timestamp: new Date('2024-01-01T00:00:00Z') },
        { path: 'database/2024-02-01/borrow_return.sql.gz', modifiedAt: new Date('2024-02-01T00:00:00Z'), timestamp: new Date('2024-02-01T00:00:00Z') }
      ]),
      deleteBackup: vi.fn().mockResolvedValue(undefined),
      backup: vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'insufficient_space' })
        .mockResolvedValueOnce({ success: true, path: 'database/2024-03-01/borrow_return.sql.gz', sizeBytes: 123 })
    } as any;

    const target = { info: { type: 'database' as const, source: 'borrow_return' } };

    const result = await recoverAndRetryBackupOnInsufficientSpace({
      backupService,
      target: target as any,
      backupOptions: { label: 'test' },
      errorMessage: 'insufficient_space'
    });

    expect(result.recovered).toBe(true);
    expect(result.deletedPaths).toEqual([
      'database/2024-01-01/borrow_return.sql.gz',
      'database/2024-02-01/borrow_return.sql.gz'
    ]);
    expect(backupService.listBackups).toHaveBeenCalledWith({ prefix: 'database' });
    expect(backupService.deleteBackup).toHaveBeenCalledWith('database/2024-01-01/borrow_return.sql.gz');
    expect(markHistoryAsDeletedByPathMock).toHaveBeenCalledWith('database/2024-01-01/borrow_return.sql.gz');
    expect(result.result).toMatchObject({ success: true, path: 'database/2024-03-01/borrow_return.sql.gz' });
  });

  it('does not delete backups of different source within same kind', async () => {
    const backupService = {
      listBackups: vi.fn().mockResolvedValue([
        { path: 'database/2024-01-01/other_db.sql.gz', modifiedAt: new Date('2024-01-01T00:00:00Z'), timestamp: new Date('2024-01-01T00:00:00Z') },
        { path: 'database/2024-01-01/borrow_return.sql.gz', modifiedAt: new Date('2024-01-01T00:00:00Z'), timestamp: new Date('2024-01-01T00:00:00Z') }
      ]),
      deleteBackup: vi.fn().mockResolvedValue(undefined),
      backup: vi.fn().mockResolvedValueOnce({ success: true, path: 'database/2024-03-01/borrow_return.sql.gz', sizeBytes: 456 })
    } as any;

    const target = { info: { type: 'database' as const, source: 'borrow_return' } };

    const result = await recoverAndRetryBackupOnInsufficientSpace({
      backupService,
      target: target as any,
      errorMessage: 'insufficient_space'
    });

    expect(result.recovered).toBe(true);
    expect(result.deletedPaths).toEqual(['database/2024-01-01/borrow_return.sql.gz']);
    expect(backupService.deleteBackup).not.toHaveBeenCalledWith('database/2024-01-01/other_db.sql.gz');
  });
});
