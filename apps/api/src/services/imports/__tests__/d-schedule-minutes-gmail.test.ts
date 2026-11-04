import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, ProductionScheduleDScheduleMinutesImportRun } from '@prisma/client';

import { defaultBackupConfig } from '../../backup/backup-config.js';
import { CsvImportExecutionService } from '../csv-import-execution.service.js';
import { CsvImportScheduler } from '../csv-import-scheduler.js';
import { ImportAlertService } from '../import-alert.service.js';
import { ensureProductionScheduleCsvImportSchedules } from '../fkojunst-import-schedule.ensure.js';
import { buildDefaultDScheduleMinutesImportSchedule, D_SCHEDULE_MINUTES_SCHEDULE_ID, resolveSystemCsvImportDefaultBuilder } from '../system-csv-import-schedule-builtin-rows.js';
import { buildWorkbook } from '../../production-schedule/d-schedule-minutes/__fixtures__/workbook.js';
import { DScheduleMinutesGmailIngestionService, saveDScheduleMinutesOriginal } from '../../production-schedule/d-schedule-minutes/d-schedule-minutes-gmail-ingestion.service.js';
import { parseDScheduleMinutesXlsx } from '../../production-schedule/d-schedule-minutes/parse-d-schedule-minutes.js';
import { deliverDScheduleMinutesNotice } from '../../kiosk-inquiry/system-notice-sources.js';
import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), write: vi.fn(), read: vi.fn(), initialize: vi.fn(),
  histories: [] as Array<Record<string, unknown>>,
  notice: null as null | Record<string, unknown>, createNotice: vi.fn(), updateNotice: vi.fn(),
}));
vi.mock('../../backup/backup-config.loader.js', () => ({ BackupConfigLoader: { load: mocks.load, save: vi.fn() } }));
// The real Gmail factory must never be used in this suite.
vi.mock('../../gmail/gmail-api-client.factory.js', () => ({ resolveGmailApiClientFromBackupConfig: vi.fn(() => { throw new Error('Unexpected real Gmail factory'); }) }));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: { initialize: mocks.initialize, write: mocks.write, read: mocks.read } }) }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvImportHistory: {
    create: ({ data }: { data: Record<string, unknown> }) => { const row = { id: String(mocks.histories.length), ...data }; mocks.histories.push(row); return row; },
    update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(mocks.histories[Number(where.id)], data),
  },
  $transaction: (fn: (tx: unknown) => unknown) => fn({
    $queryRaw: vi.fn(), kioskInquiryThread: {
      findFirst: () => mocks.notice,
      create: mocks.createNotice, update: mocks.updateNotice,
    },
  }),
} }));

const config = { ...defaultBackupConfig, storage: { provider: 'dropbox' as const, options: { gmail: { fromEmail: 'synthetic@example.com' } } } };
const row = buildDefaultDScheduleMinutesImportSchedule();
let run: ProductionScheduleDScheduleMinutesImportRun | null;
let buffer: Buffer;
let message: GmailMessage;
let gmail: {
  searchMessagesLimited: ReturnType<typeof vi.fn>; getMessage: ReturnType<typeof vi.fn>; getAttachment: ReturnType<typeof vi.fn>;
  trashMessage: ReturnType<typeof vi.fn>; markAsRead: ReturnType<typeof vi.fn>;
};
let apply: ReturnType<typeof vi.fn>;
let parse: ReturnType<typeof vi.fn>;
let execution: CsvImportExecutionService;
let ingestion: DScheduleMinutesGmailIngestionService;
let alert: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks(); mocks.createNotice.mockReset(); mocks.write.mockReset(); mocks.histories.length = 0; mocks.notice = null; run = null;
  const fixture = buildWorkbook();
  buffer = Buffer.from(await fixture.workbook.xlsx.writeBuffer());
  message = { id: 'mail-1', threadId: 'thread-1', labelIds: ['UNREAD'], snippet: '', internalDateMs: Date.parse('2026-05-15Z'), payload: {
    headers: [{ name: 'Subject', value: '転送 D社日程会議議事録 5/15' }], parts: [
      { filename: 'signature.png', body: { attachmentId: 'image' } },
      { filename: 'wrong.xlsx', body: { attachmentId: 'wrong' } },
      { filename: '20260515 D社日程会議議事録.XLSX', body: { attachmentId: 'minutes' } },
    ],
  } };
  gmail = { searchMessagesLimited: vi.fn().mockResolvedValue(['mail-1']), getMessage: vi.fn(async () => message), getAttachment: vi.fn(async () => buffer), trashMessage: vi.fn(), markAsRead: vi.fn() };
  parse = vi.fn(parseDScheduleMinutesXlsx);
  apply = vi.fn(async ({ result, metadata }) => {
    run = { ...metadata, id: 'run-1', status: 'SUCCESS', warnings: result.warnings,
      autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: { seibansRead: 6, dateChanged: 4, unchanged: 2, registeredSeibans: ['AB1C2345'], unregisteredSeibans: ['STALE123'] } },
    } as ProductionScheduleDScheduleMinutesImportRun;
    return run;
  });
  mocks.createNotice.mockImplementation(({ data }) => { mocks.notice = { ...data, id: 'notice-1', messages: [{ createdAt: new Date() }] }; return mocks.notice; });
  ingestion = new DScheduleMinutesGmailIngestionService({
    gmailFactory: vi.fn().mockResolvedValue(gmail),
    db: { productionScheduleDScheduleMinutesImportRun: { findUnique: vi.fn(async ({ where }) => run?.gmailMessageId === where.gmailMessageId || run?.id === 'partial' ? run : null) } } as unknown as PrismaClient,
    parse, apply, saveOriginal: saveDScheduleMinutesOriginal, notify: deliverDScheduleMinutesNotice,
  });
  execution = new CsvImportExecutionService({ createDScheduleMinutesGmailIngestionService: () => ingestion,
    storageProviderFactory: { createFromConfig: vi.fn(() => { throw new Error('Unexpected CSV provider'); }) },
    processCsvImportFromTargets: vi.fn(() => { throw new Error('Unexpected CSV parsing'); }),
  });
  mocks.load.mockResolvedValue({ ...config, csvImports: [row] });
  alert = vi.spyOn(ImportAlertService.prototype, 'generateFailureAlert').mockResolvedValue();
});

function execute() { return execution.execute({ config, importSchedule: row, skipRetry: true }); }
function scheduler() { return new CsvImportScheduler({ createExecutionService: () => execution }); }

describe('D schedule Gmail intake and scheduler history', () => {
  it('selects the named uppercase XLSX after signature/wrong workbook, saves before parsing, and records summary', async () => {
    await scheduler().runImport(row.id);
    expect(gmail.getAttachment).toHaveBeenCalledExactlyOnceWith('mail-1', 'minutes');
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(parse.mock.invocationCallOrder[0]!);
    expect(parse).toHaveBeenCalledWith({ buffer, filename: '20260515 D社日程会議議事録.XLSX', receivedAt: new Date('2026-05-15Z') });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ gmailMessageId: 'mail-1', subject: '転送 D社日程会議議事録 5/15', originalFilePath: expect.stringMatching(/^csv-dashboards\/d-schedule-minutes\/[a-f0-9]{64}\.xlsx$/) }) }));
    expect(mocks.histories[0]).toMatchObject({ status: 'COMPLETED', summary: { dScheduleMinutesGmail: {
      seibansRead: 6, dateChanged: 4, unchanged: 2, autoRegistered: 1, unregistered: 1, skipped: 1,
      warnings: [expect.objectContaining({ code: 'UNKNOWN_STAR' })],
    } } });
    expect(gmail.searchMessagesLimited).toHaveBeenCalledWith(expect.stringContaining('subject:"D社日程会議議事録" in:inbox is:unread -label:'), 10);
    expect(gmail.searchMessagesLimited.mock.calls[0][0]).toContain('from:synthetic@example.com');
    // trashMessage is the existing Gmail operation that adds rps_processed before moving to trash.
    expect(gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(gmail.trashMessage.mock.invocationCallOrder[0]).toBeLessThan(gmail.markAsRead.mock.invocationCallOrder[0]!);
  });

  it('marks fatal workbooks read, fails history and fires the existing failure alert without apply', async () => {
    const fixture = buildWorkbook(); fixture.sheet.getCell(3, fixture.parts).value = 'missing';
    buffer = Buffer.from(await fixture.workbook.xlsx.writeBuffer());
    await expect(scheduler().runImport(row.id)).rejects.toThrow('読み取れません');
    expect(mocks.write).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
    expect(mocks.histories[0]).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('読み取れません') });
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: row.id, historyId: '0' }));
    expect(gmail.trashMessage).not.toHaveBeenCalled(); expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(mocks.createNotice).not.toHaveBeenCalled();
  });

  it.each(['missing attachment', 'fatal parse'])('continues past %s, finalizes good mail, and fails history with the fatal ID', async (failure) => {
    const fatal = { ...message, id: 'fatal-mail', internalDateMs: message.internalDateMs - 1000,
      payload: failure === 'missing attachment' ? { headers: message.payload!.headers, parts: [] } : message.payload };
    gmail.searchMessagesLimited.mockResolvedValue(['fatal-mail', 'mail-1']);
    gmail.getMessage.mockImplementation(async (id: string) => id === 'fatal-mail' ? fatal : message);
    if (failure === 'fatal parse') parse.mockResolvedValueOnce({ ok: false, reason: 'synthetic fatal parse', warnings: [] });
    const reason = failure === 'fatal parse' ? 'synthetic fatal parse' : '日程会議議事録を含む.xlsx添付がありません';
    await expect(scheduler().runImport(row.id)).rejects.toThrow('fatal-mail:');
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].metadata.gmailMessageId).toBe('mail-1');
    expect(gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(gmail.markAsRead).toHaveBeenCalledWith('fatal-mail');
    expect(gmail.markAsRead).toHaveBeenCalledWith('mail-1');
    expect(mocks.histories[0]).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('fatal-mail:') });
    expect(mocks.histories[0].errorMessage).toContain(reason);
    expect(alert).toHaveBeenCalledOnce();
  });

  it('names every failed message and reason after attempting the whole cycle', async () => {
    gmail.searchMessagesLimited.mockResolvedValue(['fetch-failure', 'mail-1']);
    gmail.getMessage.mockImplementation(async (id: string) => {
      if (id === 'fetch-failure') throw new Error('synthetic fetch failure');
      return message;
    });
    message.payload!.parts = [];
    await expect(execute()).rejects.toThrow(/fetch-failure: synthetic fetch failure.*mail-1: .*添付がありません/);
    expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1'); expect(gmail.trashMessage).not.toHaveBeenCalled();
  });

  it('marks a non-matching subject read and skips it without processing or failure', async () => {
    message.payload!.headers = [{ name: 'Subject', value: 'D社 日程 会議議事録' }];
    const result = await ingestion.runOnce({ config, allowWait: false });
    expect(result).toMatchObject({ processed: 0, runs: [] });
    expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it.each(['missing attachment', 'fatal parse', 'invalid receivedAt'])('records %s once and excludes read mail from the next cycle', async (failure) => {
    gmail.searchMessagesLimited.mockImplementation(async () => message.labelIds.includes('UNREAD') ? ['mail-1'] : []);
    gmail.markAsRead.mockImplementation(async () => { message.labelIds = []; });
    if (failure === 'missing attachment') message.payload!.parts = [];
    if (failure === 'fatal parse') parse.mockResolvedValue({ ok: false, reason: 'invalid workbook', warnings: [] });
    if (failure === 'invalid receivedAt') message.internalDateMs = 0;
    await expect(scheduler().runImport(row.id)).rejects.toThrow('取込に失敗');
    await scheduler().runImport(row.id);
    expect(mocks.histories.map((history) => history.status)).toEqual(['FAILED', 'COMPLETED']);
    expect(alert).toHaveBeenCalledOnce();
    expect(gmail.getMessage).toHaveBeenCalledOnce();
    expect(gmail.markAsRead).toHaveBeenCalledOnce();
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('surfaces permanent failures without the automatic retry turning them into an empty success', async () => {
    message.payload!.parts = [];
    gmail.searchMessagesLimited.mockImplementation(async () => message.labelIds.includes('UNREAD') ? ['mail-1'] : []);
    gmail.markAsRead.mockImplementation(async () => { message.labelIds = []; });
    await expect(execution.execute({ config, importSchedule: row })).rejects.toThrow('添付がありません');
    expect(gmail.searchMessagesLimited).toHaveBeenCalledOnce();
    await expect(execution.execute({ config, importSchedule: row })).resolves.toBeDefined();
  });

  it.each([true, false])('retains permanent failure when mixed-cycle retries succeed: %s', async (retrySucceeds) => {
    const fatal = { ...message, id: 'fatal', payload: { headers: message.payload!.headers, parts: [] } };
    const unread = new Set(['fatal', 'mail-1']);
    gmail.searchMessagesLimited.mockImplementation(async () => [...unread]);
    gmail.getMessage.mockImplementation(async (id: string) => id === 'fatal' ? fatal : message);
    gmail.markAsRead.mockImplementation(async (id: string) => { unread.delete(id); });
    if (retrySucceeds) apply.mockRejectedValueOnce(new Error('database unavailable'));
    else apply.mockRejectedValue(new Error('database unavailable'));
    await expect(execution.execute({ config, importSchedule: { ...row,
      retryConfig: { maxRetries: 1, retryInterval: 0, exponentialBackoff: false }
    } })).rejects.toThrow('fatal:');
    expect(apply).toHaveBeenCalledTimes(2);
    expect(gmail.getMessage.mock.calls.filter(([id]) => id === 'fatal')).toHaveLength(1);
    expect(unread.size).toBe(retrySucceeds ? 0 : 1);
  });

  it('retries transient apply errors without marking the message read', async () => {
    apply.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(execute()).rejects.toThrow('database unavailable');
    expect(gmail.markAsRead).not.toHaveBeenCalled();
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    await execute();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1');
  });

  it('includes skipped stale registration in the per-run history summary', async () => {
    run = { gmailMessageId: 'mail-1', status: 'SUCCESS', warnings: [{ code: 'STALE_FILE', seiban: 'AB1C2345', cell: 'B8', rawText: null }],
      autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], autoRegistrationSkipped: 'STALE_FILE',
        metrics: { seibansRead: 1, dateChanged: 0, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] } }
    } as unknown as ProductionScheduleDScheduleMinutesImportRun;
    await scheduler().runImport(row.id);
    expect(mocks.histories[0]).toMatchObject({ summary: { dScheduleMinutesGmail: {
      dateChanged: 0, unchanged: 0, skipped: 1,
      runs: [expect.objectContaining({ gmailMessageId: 'mail-1', autoRegistrationSkipped: 'STALE_FILE' })]
    } } });
    expect(apply).not.toHaveBeenCalled();
  });

  it('explains STALE_FILE in the warning notice', async () => {
    await deliverDScheduleMinutesNotice('stale-mail', [{ code: 'STALE_FILE', seiban: 'AB1C2345', cell: 'B8', rawText: null }]);
    expect(mocks.createNotice.mock.calls[0][0].data.messages.create.body).toContain('より新しい議事録の内容を残しました');
  });

  it.each(['wrong.xlsx', '日程会議議事録.csv'])('fails a mail without a matching workbook (%s)', async (filename) => {
    message.payload!.parts = [{ filename, body: { attachmentId: 'wrong' } }];
    await expect(scheduler().runImport(row.id)).rejects.toThrow('日程会議議事録を含む.xlsx添付がありません');
    expect(mocks.histories[0].status).toBe('FAILED'); expect(alert).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled(); expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1');
  });

  it('does not reapply SUCCESS or duplicate a notice even after resolution / later retries', async () => {
    await execute();
    mocks.notice!.noticeResolvedAt = new Date();
    await execute();
    expect(apply).toHaveBeenCalledOnce(); expect(parse).toHaveBeenCalledOnce(); expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.createNotice).toHaveBeenCalledOnce(); expect(mocks.updateNotice).not.toHaveBeenCalled();
  });

  it('retries mail finalization after a notice failure without applying again', async () => {
    mocks.createNotice.mockRejectedValueOnce(new Error('notice unavailable'));
    await expect(execute()).rejects.toThrow('notice unavailable');
    expect(gmail.markAsRead).not.toHaveBeenCalled();
    await execute(); expect(apply).toHaveBeenCalledOnce(); expect(gmail.markAsRead).toHaveBeenCalledOnce();
  });

  it('passes APPLIED to apply to resume registration', async () => {
    run = { id: 'partial', status: 'APPLIED' } as ProductionScheduleDScheduleMinutesImportRun;
    await execute(); expect(apply).toHaveBeenCalledOnce(); expect(gmail.markAsRead).toHaveBeenCalledOnce();
  });

  it('builds one readable SYSTEM_NOTICE with seiban, cell, original text, explanations and a cap', async () => {
    const warnings = Array.from({ length: 25 }, (_, index) => ({ code: 'UNREADABLE_DATE', seiban: 'AB1C2345', cell: `N${23 + index}`, rawText: '4月末\n確認' }));
    await deliverDScheduleMinutesNotice('warning-mail', warnings);
    expect(mocks.createNotice).toHaveBeenCalledOnce();
    const data = mocks.createNotice.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'SYSTEM_NOTICE', noticeKey: 'd-schedule-minutes:warning-mail', receiverUnread: true });
    expect(data.messages.create.body).toContain('製番 AB1C2345 / N23 / 「4月末 確認」: 日付として読めません');
    expect(data.messages.create.body).toContain('ほか5件'); expect(data.messages.create.body).not.toContain('N43');
  });

  it('registers the hourly builtin additively and preserves edited settings on repeat ensure', () => {
    const first = ensureProductionScheduleCsvImportSchedules(config);
    expect(first.config.csvImports).toContainEqual(row);
    expect(row).toMatchObject({ enabled: true, schedule: '23 * * * *', targets: [{ type: 'dScheduleMinutesGmail', source: 'D社日程会議議事録' }] });
    expect(resolveSystemCsvImportDefaultBuilder(D_SCHEDULE_MINUTES_SCHEDULE_ID)?.()).toEqual(row);
    const updated = { ...first.config, csvImports: first.config.csvImports!.map((item) => item.id === row.id ? { ...item, enabled: false, schedule: '28 * * * *' } : item) };
    expect(ensureProductionScheduleCsvImportSchedules(updated)).toEqual({ config: updated, repaired: false });
  });

  it('verifies an existing content-addressed original instead of overwriting it', async () => {
    mocks.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError('exists'));
    mocks.read.mockResolvedValueOnce(buffer);
    await expect(saveDScheduleMinutesOriginal(buffer)).resolves.toMatch(/^csv-dashboards/);
    expect(mocks.read).toHaveBeenCalledWith(expect.any(String), { verifyIntegrity: true });
  });
});
