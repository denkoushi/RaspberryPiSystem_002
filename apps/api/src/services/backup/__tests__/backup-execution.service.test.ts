import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createFromTargetMock,
  createFromConfigMock,
  backupMock,
  createHistoryMock,
  completeHistoryMock,
  failHistoryMock,
} = vi.hoisted(() => ({
  createFromTargetMock: vi.fn(),
  createFromConfigMock: vi.fn(),
  backupMock: vi.fn(),
  createHistoryMock: vi.fn(),
  completeHistoryMock: vi.fn(),
  failHistoryMock: vi.fn(),
}));

vi.mock('../storage-provider-factory.js', () => ({
  StorageProviderFactory: {
    createFromTarget: createFromTargetMock,
    createFromConfig: createFromConfigMock,
  },
}));

vi.mock('../backup.service.js', () => ({
  BackupService: vi.fn().mockImplementation(() => ({
    backup: backupMock,
  })),
}));

vi.mock('../backup-history.service.js', () => ({
  BackupHistoryService: vi.fn().mockImplementation(() => ({
    createHistory: createHistoryMock,
    completeHistory: completeHistoryMock,
    failHistory: failHistoryMock,
  })),
}));

import { executeBackupAcrossProviders, resolveBackupProviders } from '../backup-execution.service.js';

describe('backup-execution.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createHistoryMock.mockResolvedValue('history-1');
  });

  it('resolves providers from target providers with fallback filtering', () => {
    const providers = resolveBackupProviders({
      config: {
        storage: { provider: 'local', options: {} },
        targets: [],
      } as any,
      targetConfig: {
        kind: 'csv',
        source: 'employees',
        storage: { providers: ['dropbox', 'local', 'unsupported'] },
      } as any,
    });

    expect(providers).toEqual(['dropbox', 'local']);
  });

  it('records success history with provider and duration summary', async () => {
    createFromTargetMock.mockResolvedValue({
      provider: 'dropbox',
      storageProvider: { upload: vi.fn(), download: vi.fn(), delete: vi.fn(), list: vi.fn() },
    });
    backupMock.mockResolvedValue({
      success: true,
      path: 'backup/path.csv',
      sizeBytes: 123,
    });

    const { results } = await executeBackupAcrossProviders({
      config: {
        storage: { provider: 'local', options: {} },
        targets: [],
      } as any,
      targetConfig: {
        kind: 'csv',
        source: 'employees',
        storage: { provider: 'dropbox' },
      } as any,
      target: {} as any,
      targetKind: 'csv',
      targetSource: 'employees',
      protocol: 'https:',
      host: 'example.local',
      includeDurationInSummary: true,
      includeProviderInSummary: true,
    });

    expect(results).toEqual([
      {
        provider: 'dropbox',
        success: true,
        path: 'backup/path.csv',
        sizeBytes: 123,
      },
    ]);
    expect(createHistoryMock).toHaveBeenCalledTimes(1);
    expect(completeHistoryMock).toHaveBeenCalledWith(
      'history-1',
      expect.objectContaining({
        targetKind: 'csv',
        targetSource: 'employees',
        path: 'backup/path.csv',
        sizeBytes: 123,
        provider: 'dropbox',
      })
    );
    expect(completeHistoryMock.mock.calls[0]?.[1]?.durationMs).toEqual(expect.any(Number));
  });

  it('records failed history when backup throws error', async () => {
    createFromConfigMock.mockResolvedValue({
      provider: 'local',
      storageProvider: { upload: vi.fn(), download: vi.fn(), delete: vi.fn(), list: vi.fn() },
    });
    backupMock.mockRejectedValue(new Error('backup failed'));

    const { results } = await executeBackupAcrossProviders({
      config: {
        storage: { provider: 'local', options: {} },
        targets: [],
      } as any,
      target: {} as any,
      targetKind: 'csv',
      targetSource: 'employees',
      protocol: 'https:',
      host: 'example.local',
    });

    expect(results).toEqual([{ provider: 'local', success: false, error: 'backup failed' }]);
    expect(failHistoryMock).toHaveBeenCalledWith('history-1', 'backup failed');
  });
});
