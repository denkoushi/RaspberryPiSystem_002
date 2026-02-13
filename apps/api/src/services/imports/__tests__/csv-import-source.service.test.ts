import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoMatchingMessageError } from '../../backup/storage/gmail-storage.provider.js';
import { CsvImportSourceService } from '../csv-import-source.service.js';

describe('CsvImportSourceService', () => {
  const listEnabledPatterns = vi.fn();
  const download = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when csvDashboards target is passed', async () => {
    const service = new CsvImportSourceService({ listEnabledPatterns } as any);

    await expect(
      service.downloadMasterCsv({
        target: { type: 'csvDashboards', source: 'dashboard-1' } as any,
        provider: 'gmail',
        storageProvider: { download } as any,
      })
    ).rejects.toThrow('does not support csvDashboards target');
  });

  it('downloads directly when provider is not gmail', async () => {
    download.mockResolvedValue(Buffer.from('employees'));
    const service = new CsvImportSourceService({ listEnabledPatterns } as any);

    const result = await service.downloadMasterCsv({
      target: { type: 'employees', source: 'employees.csv' } as any,
      provider: 'dropbox',
      storageProvider: { download } as any,
    });

    expect(download).toHaveBeenCalledWith('employees.csv');
    expect(result.resolvedSource).toBe('employees.csv');
    expect(result.buffer.toString()).toBe('employees');
  });

  it('tries gmail subject patterns in order and falls back to legacy pattern', async () => {
    listEnabledPatterns.mockResolvedValue(['subject-A']);
    download
      .mockRejectedValueOnce(new NoMatchingMessageError('subject-A'))
      .mockResolvedValueOnce(Buffer.from('items-csv'));

    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = new CsvImportSourceService({ listEnabledPatterns } as any);

    const result = await service.downloadMasterCsv({
      target: { type: 'items', source: 'legacy-subject' } as any,
      provider: 'gmail',
      storageProvider: { download } as any,
      logger,
    });

    expect(download).toHaveBeenNthCalledWith(1, 'subject-A');
    expect(download).toHaveBeenNthCalledWith(2, 'legacy-subject');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(result.resolvedSource).toBe('legacy-subject');
  });

  it('uses pattern cache and avoids duplicate provider calls', async () => {
    listEnabledPatterns.mockResolvedValue(['subject-A']);
    download.mockResolvedValue(Buffer.from('ok'));
    const service = new CsvImportSourceService({ listEnabledPatterns } as any);
    const cache = new Map<string, string[]>();

    await service.downloadMasterCsv({
      target: { type: 'employees', source: 'legacy-subject' } as any,
      provider: 'gmail',
      storageProvider: { download } as any,
      patternCache: cache,
    });
    await service.downloadMasterCsv({
      target: { type: 'employees', source: 'legacy-subject' } as any,
      provider: 'gmail',
      storageProvider: { download } as any,
      patternCache: cache,
    });

    expect(listEnabledPatterns).toHaveBeenCalledTimes(1);
  });

  it('throws when no matching gmail messages are found', async () => {
    listEnabledPatterns.mockResolvedValue(['subject-A']);
    download.mockRejectedValue(new NoMatchingMessageError('subject-A'));
    const service = new CsvImportSourceService({ listEnabledPatterns } as any);

    await expect(
      service.downloadMasterCsv({
        target: { type: 'employees', source: 'legacy-subject' } as any,
        provider: 'gmail',
        storageProvider: { download } as any,
      })
    ).rejects.toThrow('No matching Gmail messages found for employees');
  });
});
