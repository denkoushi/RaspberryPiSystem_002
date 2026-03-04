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
        { path: 'database/oldest.sql', modifiedAt: new Date('2024-01-01T00:00:00Z'), timestamp: new Date('2024-01-01T00:00:00Z') },
        { path: 'database/newer.sql', modifiedAt: new Date('2024-02-01T00:00:00Z'), timestamp: new Date('2024-02-01T00:00:00Z') }
      ]),
      deleteBackup: vi.fn().mockResolvedValue(undefined),
      backup: vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'insufficient_space' })
        .mockResolvedValueOnce({ success: true, path: 'database/new.sql', sizeBytes: 123 })
    } as any;

    const result = await recoverAndRetryBackupOnInsufficientSpace({
      backupService,
      target: {} as any,
      backupOptions: { label: 'test' },
      errorMessage: 'insufficient_space'
    });

    expect(result.recovered).toBe(true);
    expect(result.deletedPaths).toEqual(['database/oldest.sql', 'database/newer.sql']);
    expect(backupService.deleteBackup).toHaveBeenCalledWith('database/oldest.sql');
    expect(markHistoryAsDeletedByPathMock).toHaveBeenCalledWith('database/oldest.sql');
    expect(result.result).toMatchObject({ success: true, path: 'database/new.sql' });
  });
});
