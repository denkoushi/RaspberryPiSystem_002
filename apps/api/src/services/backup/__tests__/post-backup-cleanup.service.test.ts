import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createFromTargetMock,
  listBackupsMock,
  deleteBackupMock,
  markHistoryAsDeletedByPathMock,
  markExcessHistoryAsDeletedMock,
} = vi.hoisted(() => ({
  createFromTargetMock: vi.fn(),
  listBackupsMock: vi.fn(),
  deleteBackupMock: vi.fn(),
  markHistoryAsDeletedByPathMock: vi.fn(),
  markExcessHistoryAsDeletedMock: vi.fn(),
}));

vi.mock('../storage-provider-factory.js', () => ({
  StorageProviderFactory: {
    createFromTarget: createFromTargetMock,
  },
}));

vi.mock('../backup.service.js', () => ({
  BackupService: vi.fn().mockImplementation(() => ({
    listBackups: listBackupsMock,
    deleteBackup: deleteBackupMock,
  })),
}));

vi.mock('../backup-history.service.js', () => ({
  BackupHistoryService: vi.fn().mockImplementation(() => ({
    markHistoryAsDeletedByPath: markHistoryAsDeletedByPathMock,
    markExcessHistoryAsDeleted: markExcessHistoryAsDeletedMock,
  })),
}));

import { cleanupBackupsAfterManualExecution } from '../post-backup-cleanup.service.js';

describe('cleanupBackupsAfterManualExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFromTargetMock.mockResolvedValue({
      provider: 'dropbox',
      storageProvider: {
        upload: vi.fn(),
        download: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      },
    });
    markHistoryAsDeletedByPathMock.mockResolvedValue(1);
    markExcessHistoryAsDeletedMock.mockResolvedValue(1);
  });

  it('returns immediately when targetConfig is missing', async () => {
    await cleanupBackupsAfterManualExecution({
      config: { storage: { provider: 'local', options: {} }, retention: { maxBackups: 3 } } as any,
      targetKind: 'csv',
      targetSource: 'employees',
      protocol: 'https:',
      host: 'example.local',
      resolvedProviders: [{ provider: 'local' } as any],
      results: [{ provider: 'local', success: true }],
      onTokenUpdate: vi.fn(),
    });

    expect(createFromTargetMock).not.toHaveBeenCalled();
    expect(listBackupsMock).not.toHaveBeenCalled();
  });

  it('deletes old backups for matching database source and marks histories', async () => {
    listBackupsMock.mockResolvedValue([
      { path: 'database/2024-01-01/borrow_return.sql.gz', modifiedAt: new Date('2024-01-01T00:00:00Z') },
      { path: 'database/2024-02-01/borrow_return.sql', modifiedAt: new Date('2024-02-01T00:00:00Z') },
      { path: 'database/2024-03-01/other_db.sql.gz', modifiedAt: new Date('2024-03-01T00:00:00Z') },
    ]);

    await cleanupBackupsAfterManualExecution({
      config: { storage: { provider: 'local', options: {} }, retention: { maxBackups: 1 } } as any,
      targetConfig: {
        kind: 'database',
        source: 'postgres://localhost/borrow_return',
        retention: { maxBackups: 1 },
      } as any,
      targetKind: 'database',
      targetSource: 'postgres://localhost/borrow_return',
      protocol: 'https:',
      host: 'example.local',
      resolvedProviders: [{ provider: 'dropbox' } as any, { provider: 'local' } as any],
      results: [
        { provider: 'dropbox', success: true, path: 'database/2024-02-01/borrow_return.sql' },
        { provider: 'local', success: false, error: 'failed' },
      ],
      onTokenUpdate: vi.fn(),
    });

    expect(createFromTargetMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        kind: 'database',
        storage: expect.objectContaining({
          provider: expect.objectContaining({ provider: 'dropbox' }),
        }),
      }),
      'https:',
      'example.local',
      expect.any(Function)
    );
    expect(listBackupsMock).toHaveBeenCalledWith({ prefix: 'database' });
    expect(deleteBackupMock).toHaveBeenCalledTimes(1);
    expect(deleteBackupMock).toHaveBeenCalledWith('database/2024-01-01/borrow_return.sql.gz');
    expect(markHistoryAsDeletedByPathMock).toHaveBeenCalledWith('database/2024-01-01/borrow_return.sql.gz');
    expect(markExcessHistoryAsDeletedMock).toHaveBeenCalledWith({
      targetKind: 'database',
      targetSource: 'postgres://localhost/borrow_return',
      maxCount: 1,
    });
  });
});
