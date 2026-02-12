import { describe, expect, it, vi } from 'vitest';

import { CsvDashboardSourceService } from '../csv-dashboard-source.service.js';

describe('CsvDashboardSourceService', () => {
  it('gmail + downloadAllWithMetadata を優先して複数結果を返す', async () => {
    const service = new CsvDashboardSourceService();
    const provider = {
      downloadAllWithMetadata: vi.fn().mockResolvedValue([
        { buffer: Buffer.from('a'), messageId: 'id-1', messageSubject: 'sub-1' },
        { buffer: Buffer.from('b'), messageId: 'id-2', messageSubject: 'sub-2' },
      ]),
      download: vi.fn(),
    };

    const result = await service.downloadCsv({
      provider: 'gmail',
      storageProvider: provider as never,
      gmailSubjectPattern: 'subject',
    });

    expect(provider.downloadAllWithMetadata).toHaveBeenCalledWith('subject');
    expect(result).toEqual([
      { buffer: Buffer.from('a'), messageId: 'id-1', messageSubject: 'sub-1' },
      { buffer: Buffer.from('b'), messageId: 'id-2', messageSubject: 'sub-2' },
    ]);
  });

  it('gmail + downloadWithMetadata がある場合は単一結果を返す', async () => {
    const service = new CsvDashboardSourceService();
    const provider = {
      downloadWithMetadata: vi.fn().mockResolvedValue({
        buffer: Buffer.from('x'),
        messageId: 'id-x',
        messageSubject: 'sub-x',
      }),
      download: vi.fn(),
    };

    const result = await service.downloadCsv({
      provider: 'gmail',
      storageProvider: provider as never,
      gmailSubjectPattern: 'subject-2',
    });

    expect(provider.downloadWithMetadata).toHaveBeenCalledWith('subject-2');
    expect(result).toEqual([
      { buffer: Buffer.from('x'), messageId: 'id-x', messageSubject: 'sub-x' },
    ]);
  });

  it('gmail 以外は download フォールバックを使う', async () => {
    const service = new CsvDashboardSourceService();
    const provider = {
      download: vi.fn().mockResolvedValue(Buffer.from('raw')),
    };

    const result = await service.downloadCsv({
      provider: 'dropbox',
      storageProvider: provider as never,
      gmailSubjectPattern: 'ignored',
    });

    expect(provider.download).toHaveBeenCalledWith('ignored');
    expect(result).toEqual([{ buffer: Buffer.from('raw') }]);
  });
});
