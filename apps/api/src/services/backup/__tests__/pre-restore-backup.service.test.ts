import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createFromConfigMock, executeBackupAcrossProvidersMock } = vi.hoisted(() => ({
  createFromConfigMock: vi.fn(),
  executeBackupAcrossProvidersMock: vi.fn(),
}));

vi.mock('../backup-target-factory.js', () => ({
  BackupTargetFactory: {
    createFromConfig: createFromConfigMock,
  },
}));

vi.mock('../backup-execution.service.js', () => ({
  executeBackupAcrossProviders: executeBackupAcrossProvidersMock,
}));

import { ApiError } from '../../../lib/errors.js';
import { runPreRestoreBackup } from '../pre-restore-backup.service.js';

describe('runPreRestoreBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFromConfigMock.mockReturnValue({ kind: 'csv-target' });
  });

  it('uses generated label and succeeds when at least one provider succeeds', async () => {
    executeBackupAcrossProvidersMock.mockResolvedValue({
      results: [
        { provider: 'dropbox', success: false, error: 'temporary error' },
        { provider: 'local', success: true, path: '/tmp/backup.sql.gz' },
      ],
    });

    const config = {
      storage: { provider: 'local', options: {} },
      targets: [{ kind: 'database', source: 'postgres://localhost/borrow_return' }],
    } as any;

    await runPreRestoreBackup({
      config,
      targetKind: 'database',
      targetSource: 'postgres://localhost/borrow_return',
      protocol: 'https:',
      host: 'example.local',
    });

    expect(createFromConfigMock).toHaveBeenCalledWith(
      config,
      'database',
      'postgres://localhost/borrow_return',
      expect.objectContaining({
        label: expect.stringMatching(/^pre-restore-/),
      })
    );
    expect(executeBackupAcrossProvidersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKind: 'database',
        targetSource: 'postgres://localhost/borrow_return',
        protocol: 'https:',
        host: 'example.local',
        label: expect.stringMatching(/^pre-restore-/),
      })
    );
  });

  it('throws ApiError when all providers fail', async () => {
    executeBackupAcrossProvidersMock.mockResolvedValue({
      results: [
        { provider: 'dropbox', success: false, error: 'token expired' },
        { provider: 'local', success: false, error: 'disk full' },
      ],
    });

    await expect(
      runPreRestoreBackup({
        config: { storage: { provider: 'local', options: {} }, targets: [] } as any,
        targetKind: 'csv',
        targetSource: 'employees',
        protocol: 'https:',
        host: 'example.local',
      })
    ).rejects.toMatchObject<ApiError>({
      statusCode: 500,
      message: expect.stringContaining('Pre-backup failed on all providers'),
    });
  });
});
