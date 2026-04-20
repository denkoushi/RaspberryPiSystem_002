import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NoMatchingMessageError } from '../../backup/storage/gmail-storage.provider.js';
import { CsvDashboardImportService } from '../csv-dashboard-import.service.js';

const { findUniqueMock, upsertMock, findFirstMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvDashboard: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
    csvDashboardIngestRun: {
      findFirst: findFirstMock,
      update: updateMock,
    },
  },
}));

describe('CsvDashboardImportService ingest behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({
      id: 'dashboard-1',
      enabled: true,
      gmailSubjectPattern: 'FKOBAINO',
    });
    upsertMock.mockResolvedValue(undefined);
    findFirstMock.mockResolvedValue({ id: 'ingest-run-1', errorMessage: null });
    updateMock.mockResolvedValue(undefined);
  });

  it('returns empty result when no matching Gmail message exists', async () => {
    const service = new CsvDashboardImportService() as any;
    service.subjectPatternProvider = {
      listEnabledPatterns: vi.fn().mockResolvedValue(['FKOBAINO']),
    };
    service.sourceService = {
      downloadCsv: vi.fn().mockRejectedValue(new NoMatchingMessageError('subject:FKOBAINO')),
    };

    const result = await service.ingestTargets({
      provider: 'gmail',
      storageProvider: {},
      dashboardIds: ['dashboard-1'],
    });

    expect(result).toEqual({});
  });

  it('ensures missing FKOBAINO dashboard before ingest subject resolution', async () => {
    const service = new CsvDashboardImportService() as any;
    service.subjectPatternProvider = {
      listEnabledPatterns: vi.fn().mockResolvedValue(['FKOBAINO']),
    };
    service.sourceService = {
      downloadCsv: vi.fn().mockResolvedValue([]),
    };

    await service.ingestTargets({
      provider: 'gmail',
      storageProvider: {},
      dashboardIds: ['c3d4e5f6-a7b8-49c0-d1e2-f3a4b5c6d7e8'],
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c3d4e5f6-a7b8-49c0-d1e2-f3a4b5c6d7e8' },
      })
    );
  });

  it('fails the run when trashMessage fails after rows are ingested', async () => {
    const markAsRead = vi.fn().mockResolvedValue(undefined);
    const trashMessage = vi.fn().mockRejectedValue(new Error('insufficient Gmail scope'));
    const service = new CsvDashboardImportService() as any;
    service.subjectPatternProvider = {
      listEnabledPatterns: vi.fn().mockResolvedValue(['FKOBAINO']),
    };
    service.sourceService = {
      downloadCsv: vi.fn().mockResolvedValue([
        { buffer: Buffer.from('h1,h2\nv1,v2\n'), messageId: 'message-123456', messageSubject: 'FKOBAINO' },
      ]),
    };
    service.ingestor = {
      ingestFromGmail: vi.fn().mockResolvedValue({
        ingestRunId: 'ingest-run-1',
        rowsProcessed: 1,
        rowsAdded: 1,
        rowsSkipped: 0,
      }),
    };
    service.postIngestService = {
      runAfterSuccessfulIngest: vi.fn().mockResolvedValue({}),
    };

    await expect(
      service.ingestTargets({
        provider: 'gmail',
        storageProvider: { markAsRead, trashMessage },
        dashboardIds: ['dashboard-1'],
      })
    ).rejects.toThrow('insufficient Gmail scope');

    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(trashMessage).toHaveBeenCalledTimes(1);
  });
});
