import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NoMatchingMessageError } from '../../backup/storage/gmail-storage.provider.js';
import { CsvDashboardStorage } from '../../../lib/csv-dashboard-storage.js';
import { logger } from '../../../lib/logger.js';
import { ApiError } from '../../../lib/errors.js';
import { CsvDashboardImportService } from '../csv-dashboard-import.service.js';
import {
  SCAW_STFUTEKIGO_DASHBOARD_ID,
  SCAW_STFUTEKIGO_SUBJECT_PATTERN,
} from '../../scaw-stfutekigo/constants.js';

const { findUniqueMock, upsertMock, findFirstMock, updateMock, createMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvDashboard: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
    csvDashboardIngestRun: {
      create: createMock,
      findFirst: findFirstMock,
      update: updateMock,
    },
  },
}));

vi.mock('../../../lib/csv-dashboard-storage.js', () => ({
  CsvDashboardStorage: { saveRawCsv: vi.fn().mockResolvedValue('/tmp/raw.csv') },
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
    createMock.mockResolvedValue({ id: 'empty-run-1' });
  });

  function setupMessages(contents: string[]) {
    const service = new CsvDashboardImportService() as any;
    const receivedAt = new Date('2026-09-02T01:23:45.000Z');
    service.subjectPatternProvider = { listEnabledPatterns: vi.fn().mockResolvedValue(['FKOBAINO']) };
    service.sourceService = {
      downloadCsv: vi.fn().mockResolvedValue(contents.map((content, index) => ({
        buffer: Buffer.from(content),
        messageId: `message-${String(index + 1).padStart(6, '0')}`,
        messageSubject: 'FKOBAINO',
        receivedAt,
      }))),
    };
    service.ingestor = {
      ingestFromGmail: vi.fn().mockResolvedValue({
        ingestRunId: 'normal-run-1', rowsProcessed: 2, rowsAdded: 1, rowsSkipped: 1,
      }),
    };
    service.postIngestService = { runAfterSuccessfulIngest: vi.fn().mockResolvedValue({}) };
    service.measuringInstrumentLoanEventService = { projectEventsFromCsv: vi.fn() };
    const storageProvider = {
      markAsRead: vi.fn().mockResolvedValue(undefined),
      trashMessage: vi.fn().mockResolvedValue(undefined),
    };
    const ingest = () => service.ingestTargets({ provider: 'gmail', storageProvider, dashboardIds: ['dashboard-1'] });
    return { service, storageProvider, receivedAt, ingest };
  }

  it.each(['\uFEFF', '', '\n', '\r\n\r\n'])('skips empty CSV %j and post-processes Gmail', async (content) => {
    const { service, storageProvider, receivedAt, ingest } = setupMessages([content]);
    const result = await ingest();

    expect(service.ingestor.ingestFromGmail).not.toHaveBeenCalled();
    expect(CsvDashboardStorage.saveRawCsv).not.toHaveBeenCalled();
    expect(service.postIngestService.runAfterSuccessfulIngest).not.toHaveBeenCalled();
    expect(service.measuringInstrumentLoanEventService.projectEventsFromCsv).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({ data: {
      csvDashboardId: 'dashboard-1',
      status: 'COMPLETED',
      messageId: 'message-000001',
      messageSubject: 'FKOBAINO',
      csvFilePath: null,
      sourceReceivedAt: receivedAt,
      rowsProcessed: 0, rowsAdded: 0, rowsSkipped: 0,
      completedAt: expect.any(Date),
      errorMessage: '[ingest-audit] postProcessState=skipped_empty reason=empty CSV (no header row, no data rows)',
    } });
    expect(updateMock).not.toHaveBeenCalled();
    expect(storageProvider.markAsRead).toHaveBeenCalledExactlyOnceWith('message-000001');
    expect(storageProvider.trashMessage).toHaveBeenCalledExactlyOnceWith('message-000001');
    expect(result['dashboard-1']).toMatchObject({
      rowsProcessed: 0, rowsAdded: 0, rowsSkipped: 0,
      debug: {
        skippedEmptyMessageIdSuffixes: ['000001'],
        postProcessedMessageIdSuffixes: ['000001'],
        postProcessStateByMessageIdSuffix: { '000001': 'skipped_empty' },
        failedMessageIdSuffixes: [],
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { dashboardId: 'dashboard-1', messageId: 'message-000001', sizeBytes: Buffer.byteLength(content), postProcessState: 'skipped_empty' },
      '[CsvDashboardImportService] Empty CSV skipped (no header row, no data rows)'
    );
  });

  it('aggregates only normal CSV rows when empty and normal messages arrive together', async () => {
    const { service, storageProvider, ingest } = setupMessages(['\uFEFF', 'h1,h2\nv1,v2\n']);
    const result = await ingest();
    expect(service.ingestor.ingestFromGmail).toHaveBeenCalledTimes(1);
    expect(service.ingestor.ingestFromGmail).toHaveBeenCalledWith(
      'dashboard-1', 'h1,h2\nv1,v2\n', 'message-000002', 'FKOBAINO', '/tmp/raw.csv', expect.any(Date)
    );
    expect(CsvDashboardStorage.saveRawCsv).toHaveBeenCalledTimes(1);
    expect(storageProvider.trashMessage).toHaveBeenCalledTimes(2);
    expect(result['dashboard-1']).toMatchObject({
      rowsProcessed: 2, rowsAdded: 1, rowsSkipped: 1,
      debug: {
        skippedEmptyMessageIdSuffixes: ['000001'],
        postProcessStateByMessageIdSuffix: { '000001': 'skipped_empty', '000002': 'completed' },
        failedMessageIdSuffixes: [],
      },
    });
  });

  it('fails and retains the message when trashMessage fails for empty CSV', async () => {
    const { service, storageProvider, ingest } = setupMessages(['\uFEFF']);
    storageProvider.trashMessage.mockRejectedValue(new Error('insufficient Gmail scope'));
    await expect(ingest()).rejects.toThrow('insufficient Gmail scope');
    expect(storageProvider.markAsRead).toHaveBeenCalledTimes(1);
    expect(storageProvider.trashMessage).toHaveBeenCalledTimes(1);
    expect(service.ingestor.ingestFromGmail).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'ingest-run-1' },
      data: { errorMessage: '[ingest-audit] postProcessState=failed reason=insufficient Gmail scope' },
    });
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

  it('resolves when a non-retriable message is trashed and another message succeeds', async () => {
    const markAsRead = vi.fn().mockResolvedValue(undefined);
    const trashMessage = vi.fn().mockResolvedValue(undefined);
    const service = new CsvDashboardImportService() as any;
    service.subjectPatternProvider = {
      listEnabledPatterns: vi.fn().mockResolvedValue(['生産日程_三島_研削工程']),
    };
    service.sourceService = {
      downloadCsv: vi
        .fn()
        .mockResolvedValueOnce([
          { buffer: Buffer.from('bad-header\nx\n'), messageId: 'message-bad-000001', messageSubject: '生産日程_三島_研削工程' },
          { buffer: Buffer.from('ok-header\nx\n'), messageId: 'message-good-000002', messageSubject: '生産日程_三島_研削工程' },
        ])
        .mockResolvedValueOnce([]),
    };
    service.ingestor = {
      ingestFromGmail: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(400, 'CSV header mismatch', undefined, 'CSV_HEADER_MISMATCH'))
        .mockResolvedValueOnce({
          ingestRunId: 'ingest-run-2',
          rowsProcessed: 10,
          rowsAdded: 10,
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
    ).resolves.toMatchObject({
      'dashboard-1': {
        rowsProcessed: 10,
        rowsAdded: 10,
        rowsSkipped: 0,
      },
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: { errorMessage: expect.stringContaining('postProcessState=disposed_non_retriable') },
    }));
    expect(trashMessage).toHaveBeenCalledTimes(2);
    expect(markAsRead).toHaveBeenCalledTimes(1);
  });

  it('accepts only the exact fixed subject and forwards the Gmail received time', async () => {
    const receivedAt = new Date('2026-09-02T01:23:45.000Z');
    findUniqueMock.mockResolvedValue({
      id: SCAW_STFUTEKIGO_DASHBOARD_ID,
      enabled: true,
      gmailSubjectPattern: SCAW_STFUTEKIGO_SUBJECT_PATTERN,
    });
    const service = new CsvDashboardImportService() as any;
    service.subjectPatternProvider = {
      listEnabledPatterns: vi.fn().mockResolvedValue([SCAW_STFUTEKIGO_SUBJECT_PATTERN]),
    };
    service.unifiedMailboxFetcher = {
      fetchBySubjectPatterns: vi.fn().mockResolvedValue({
        [SCAW_STFUTEKIGO_SUBJECT_PATTERN]: [
          {
            buffer: Buffer.from('exact'),
            messageId: 'message-exact',
            messageSubject: ` ${SCAW_STFUTEKIGO_SUBJECT_PATTERN.toUpperCase()} `,
            receivedAt,
          },
          {
            buffer: Buffer.from('near'),
            messageId: 'message-near',
            messageSubject: `${SCAW_STFUTEKIGO_SUBJECT_PATTERN}_backup`,
            receivedAt: new Date('2026-09-02T01:24:45.000Z'),
          },
        ],
      }),
    };
    service.ingestor = {
      ingestFromGmail: vi.fn().mockResolvedValue({
        ingestRunId: 'ingest-run-1',
        rowsProcessed: 1,
        rowsAdded: 1,
        rowsSkipped: 0,
      }),
    };
    service.postIngestService = { runAfterSuccessfulIngest: vi.fn().mockResolvedValue({}) };

    await service.ingestTargets({
      provider: 'gmail',
      storageProvider: {
        downloadAllBySubjectPatterns: vi.fn(),
        markAsRead: vi.fn().mockResolvedValue(undefined),
        trashMessage: vi.fn().mockResolvedValue(undefined),
      },
      dashboardIds: [SCAW_STFUTEKIGO_DASHBOARD_ID],
    });

    expect(service.ingestor.ingestFromGmail).toHaveBeenCalledTimes(1);
    expect(service.ingestor.ingestFromGmail).toHaveBeenCalledWith(
      SCAW_STFUTEKIGO_DASHBOARD_ID,
      'exact',
      'message-exact',
      expect.any(String),
      expect.any(String),
      receivedAt
    );
  });

  it.each(['[ItemlistRaspi-photo] 2', '[Procedure-material] DFD1'])('skips dedicated mail %s before other ingestion', async (ownedSubject) => {
    const service = new CsvDashboardImportService() as any;
    service.subjectPatternProvider = {
      listEnabledPatterns: vi.fn().mockResolvedValue(['CSV Import']),
    };
    service.unifiedMailboxFetcher = {
      fetchBySubjectPatterns: vi.fn().mockResolvedValue({
        'CSV Import': [{
          buffer: Buffer.from('{"schema_version":1}'),
          messageId: 'inventory-message',
          messageSubject: ownedSubject,
        }],
      }),
    };
    service.ingestor = { ingestFromGmail: vi.fn() };

    const result = await service.ingestTargets({
      provider: 'gmail',
      storageProvider: { downloadAllBySubjectPatterns: vi.fn() },
      dashboardIds: ['dashboard-1'],
    });

    expect(service.ingestor.ingestFromGmail).not.toHaveBeenCalled();
    expect(result['dashboard-1'].debug.downloadedMessageIdSuffixes).toEqual([]);
  });
});
