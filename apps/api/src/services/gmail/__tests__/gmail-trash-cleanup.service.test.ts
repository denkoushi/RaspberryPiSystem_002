import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailTrashCleanupService } from '../gmail-trash-cleanup.service.js';
import { BackupConfigLoader } from '../../backup/backup-config.loader.js';
import { StorageProviderFactory } from '../../backup/storage-provider-factory.js';

vi.mock('../../backup/backup-config.loader.js', () => ({
  BackupConfigLoader: {
    load: vi.fn(),
    save: vi.fn(),
  },
}));

vi.mock('../../backup/storage-provider-factory.js', () => ({
  StorageProviderFactory: {
    createFromConfig: vi.fn(),
  },
}));

describe('GmailTrashCleanupService', () => {
  const service = new GmailTrashCleanupService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip when Gmail settings are incomplete', async () => {
    vi.mocked(BackupConfigLoader.load).mockResolvedValueOnce({
      storage: {
        provider: 'local',
        options: {},
      },
      targets: [],
      csvImports: [],
    } as never);

    const result = await service.cleanup();

    expect(result).toBeNull();
    expect(StorageProviderFactory.createFromConfig).not.toHaveBeenCalled();
  });

  it('should run cleanup via Gmail provider', async () => {
    const cleanupProcessedTrash = vi.fn().mockResolvedValue({
      query: 'label:TRASH label:rps_processed older_than:30m',
      totalMatched: 2,
      deletedCount: 2,
      errors: [],
    });
    vi.mocked(BackupConfigLoader.load).mockResolvedValue({
      storage: {
        provider: 'local',
        options: {
          gmail: {
            clientId: 'client-id',
            clientSecret: 'client-secret',
            accessToken: 'token',
          },
        },
      },
      targets: [],
      csvImports: [],
    } as never);
    vi.mocked(StorageProviderFactory.createFromConfig).mockResolvedValueOnce({
      provider: 'gmail',
      storageProvider: {
        cleanupProcessedTrash,
      },
    } as never);

    const result = await service.cleanup({
      processedLabelName: 'rps_processed',
      minAgeQuery: 'older_than:30m',
    });

    expect(StorageProviderFactory.createFromConfig).toHaveBeenCalled();
    expect(cleanupProcessedTrash).toHaveBeenCalledWith({
      processedLabelName: 'rps_processed',
      minAgeQuery: 'older_than:30m',
    });
    expect(result?.deletedCount).toBe(2);
  });
});

