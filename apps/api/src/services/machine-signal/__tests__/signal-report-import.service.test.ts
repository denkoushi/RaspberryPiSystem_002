import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sensorUpsert: vi.fn((args: unknown) => ({ model: 'sensor', args })),
  reportUpsert: vi.fn((args: unknown) => ({ model: 'report', args })),
  transaction: vi.fn(),
  runCreate: vi.fn(),
  runFindMany: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    machineSignalSensor: { upsert: mocks.sensorUpsert },
    machineSignalDailyReport: { upsert: mocks.reportUpsert },
    machineSignalImportRun: { create: mocks.runCreate, findMany: mocks.runFindMany },
    $transaction: mocks.transaction,
  },
}));

import { importSignalReportFiles, listSignalImportRuns } from '../signal-report-import.service.js';

const REPORT = [
  '日報データ,2026/10/01, HCN4000,,,,,,,',
  '稼働時間,06:12:19,,,,,,,,',
  'カウント 08:00,,,,,,,,,',
  '2026/10/01 08:00:00,2026/10/01 09:00:00,3600,1,1,2,,,,赤消灯:黄消灯:緑点灯::::設備稼働',
  '',
].join('\r\n');

describe('importSignalReportFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockResolvedValue([]);
    mocks.runCreate.mockResolvedValue({ id: 'run-1' });
  });

  it('stores one report per sensor and day, keyed by the Signal number of the file name', async () => {
    const summary = await importSignalReportFiles(
      [{ fileName: '2026-10-01/DailySummary_Signal8_20261001.csv', content: Buffer.from(REPORT) }],
      { source: 'UPLOAD' }
    );

    expect(mocks.sensorUpsert).toHaveBeenCalledWith({
      where: { signalNo: 8 },
      create: { signalNo: 8, sourceMachineName: 'HCN4000' },
      update: { sourceMachineName: 'HCN4000' },
    });
    const report = mocks.reportUpsert.mock.calls[0][0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(report.where).toEqual({ signalNo_reportDate: { signalNo: 8, reportDate: new Date('2026-10-01T00:00:00.000Z') } });
    expect(report.create).toMatchObject({
      signalNo: 8,
      machineName: 'HCN4000',
      dayStartMinute: 480,
      stateNames: ['設備稼働'],
      segments: [[0, 3_600, 1, 1, 2, 0]],
      source: 'UPLOAD',
      sourceFileName: 'DailySummary_Signal8_20261001.csv',
    });
    // 上書き時に設定（表示名や工場）を消さないよう、センサー側は機械名だけを更新する。
    expect(report.update).not.toHaveProperty('signalNo');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ runId: 'run-1', status: 'SUCCESS', importedCount: 1, failedCount: 0, reportDates: ['2026-10-01'] });
  });

  it('skips unreadable files, keeps going, and records the reasons', async () => {
    const summary = await importSignalReportFiles(
      [
        { fileName: 'memo.csv', content: Buffer.from(REPORT) },
        { fileName: 'DailySummary_Signal9_20261001.csv', content: Buffer.from('a,b,c') },
        { fileName: 'DailySummary_Signal8_20261001.csv', content: Buffer.from(REPORT) },
      ],
      { source: 'GMAIL', gmailMessageId: 'm1' }
    );

    expect(summary).toMatchObject({ status: 'PARTIAL', fileCount: 3, importedCount: 1, failedCount: 2 });
    expect(summary.failures.map((failure) => failure.fileName)).toEqual(['memo.csv', 'DailySummary_Signal9_20261001.csv']);
    expect(mocks.runCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: 'GMAIL', gmailMessageId: 'm1', status: 'PARTIAL', failedCount: 2 }),
    });
  });

  it('marks the run failed when nothing could be imported', async () => {
    const summary = await importSignalReportFiles([{ fileName: 'memo.csv', content: Buffer.from('x') }], { source: 'GMAIL' });
    expect(summary.status).toBe('FAILED');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('stops on a database error instead of reporting it as a bad file', async () => {
    mocks.transaction.mockRejectedValue(new Error('db down'));
    await expect(
      importSignalReportFiles([{ fileName: 'DailySummary_Signal8_20261001.csv', content: Buffer.from(REPORT) }], { source: 'UPLOAD' })
    ).rejects.toThrow('db down');
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });
});

describe('listSignalImportRuns', () => {
  it('returns the latest runs with their failures', async () => {
    mocks.runFindMany.mockResolvedValue([
      {
        id: 'run-1',
        source: 'GMAIL',
        status: 'PARTIAL',
        fileCount: 50,
        importedCount: 49,
        failedCount: 1,
        errors: [{ fileName: 'memo.csv', reason: 'x' }],
        startedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    ]);
    await expect(listSignalImportRuns()).resolves.toEqual([
      {
        id: 'run-1',
        source: 'GMAIL',
        status: 'PARTIAL',
        fileCount: 50,
        importedCount: 49,
        failedCount: 1,
        failures: [{ fileName: 'memo.csv', reason: 'x' }],
        startedAt: '2026-10-02T00:00:00.000Z',
      },
    ]);
  });
});
