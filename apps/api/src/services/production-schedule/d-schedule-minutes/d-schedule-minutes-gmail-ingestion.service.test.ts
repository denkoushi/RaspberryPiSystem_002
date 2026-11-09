import ExcelJS from 'exceljs';
import type { PrismaClient, ProductionScheduleDScheduleMinutesImportRun } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBackupConfig } from '../../backup/backup-config.js';
import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { buildWorkbook } from './__fixtures__/workbook.js';
import { DScheduleMinutesContentError, DScheduleMinutesGmailIngestionService } from './d-schedule-minutes-gmail-ingestion.service.js';
import { parseDScheduleMinutesXlsx } from './parse-d-schedule-minutes.js';

vi.mock('../../kiosk-inquiry/system-notice-sources.js', () => ({ deliverDScheduleMinutesNotice: vi.fn() }));

const config = { ...defaultBackupConfig, gmailIngestSenderPolicy: { allowedSenderDomains: ['example.com'] } };
let dBuffer: Buffer;
let internalBuffer: Buffer;
let messages: GmailMessage[];
let runs: Map<string, ProductionScheduleDScheduleMinutesImportRun>;
let ingestion: DScheduleMinutesGmailIngestionService;
let gmail: { searchMessagesLimited: ReturnType<typeof vi.fn>; getMessage: ReturnType<typeof vi.fn>; getAttachment: ReturnType<typeof vi.fn>; trashMessage: ReturnType<typeof vi.fn>; markAsRead: ReturnType<typeof vi.fn> };
let apply: ReturnType<typeof vi.fn>;
let notify: ReturnType<typeof vi.fn>;
const key = (id: string, kind: string) => `${id}:${kind}`;
const cycle = () => ingestion.runOnce({ config, allowWait: false });
function mail(id: string, attachments = ['d', 'internal']): GmailMessage {
  return { id, threadId: id, labelIds: ['UNREAD'], snippet: '', internalDateMs: Date.parse('2026-11-07Z'), payload: {
    headers: [{ name: 'From', value: 'synthetic@example.com' }, { name: 'Authentication-Results', value: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass' }],
    parts: attachments.map((attachmentId) => ({ filename: attachmentId === 'd' ? '20261107D社日程会議議事録.xlsx' : '日程会議議事録_1106.xlsx', body: { attachmentId } }))
  } };
}

beforeEach(async () => {
  const d = buildWorkbook('Oct'); dBuffer = Buffer.from(await d.workbook.xlsx.writeBuffer());
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('1106結果');
  sheet.getCell('B1').value = new Date('2026-11-06Z');
  sheet.addRow(['【架空区分】']); sheet.addRow(['製番', '製品名', '客先名', '部品']);
  sheet.addRow(['BA1SB203', '架空製品', '架空客先', 46338]);
  internalBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  messages = [mail('mail-1')]; runs = new Map();
  gmail = {
    searchMessagesLimited: vi.fn(async () => messages.map((message) => message.id)),
    getMessage: vi.fn(async (id: string) => messages.find((message) => message.id === id)),
    getAttachment: vi.fn(async (_id: string, attachmentId: string) => attachmentId === 'd' ? dBuffer : internalBuffer),
    trashMessage: vi.fn(), markAsRead: vi.fn()
  };
  apply = vi.fn(async ({ metadata, result }) => {
    const run = { ...metadata, id: key(metadata.gmailMessageId, metadata.kind), status: 'SUCCESS', warnings: result.warnings,
      autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: { seibansRead: result.blocks.length, dateChanged: 1, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] } }
    } as ProductionScheduleDScheduleMinutesImportRun;
    runs.set(key(run.gmailMessageId, run.kind), run); return run;
  });
  notify = vi.fn();
  ingestion = new DScheduleMinutesGmailIngestionService({
    gmailFactory: vi.fn().mockResolvedValue(gmail), parse: parseDScheduleMinutesXlsx, apply, notify,
    saveOriginal: vi.fn().mockResolvedValue('synthetic.xlsx'),
    db: { productionScheduleDScheduleMinutesImportRun: { findUnique: vi.fn(async ({ where }) => {
      const { gmailMessageId, kind } = where.gmailMessageId_kind;
      return runs.get(key(gmailMessageId, kind)) ?? null;
    }) } } as unknown as PrismaClient
  });
});

describe('minutes Gmail attachments by kind', () => {
  it('applies both attachments with an empty subject and finalizes the email once after both', async () => {
    const summary = await cycle();
    expect([...runs.keys()]).toEqual(['mail-1:D_COMPANY', 'mail-1:INTERNAL']);
    expect(summary).toMatchObject({ processed: 2, dateChanged: 2, runs: [{ kind: 'D_COMPANY' }, { kind: 'INTERNAL' }] });
    expect(notify.mock.calls.map((call) => call[2])).toEqual(['D_COMPANY', 'INTERNAL']);
    expect(gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('mail-1');
    expect(apply.mock.invocationCallOrder[1]).toBeLessThan(gmail.trashMessage.mock.invocationCallOrder[0]!);
  });

  it.each(['D_COMPANY', 'INTERNAL'])('processes only the remaining kind when %s already succeeded', async (kind) => {
    await cycle(); const existing = runs.get(key('mail-1', kind))!;
    runs.clear(); runs.set(key('mail-1', kind), existing); apply.mockClear(); gmail.trashMessage.mockClear();
    await cycle();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].metadata.kind).toBe(kind === 'D_COMPANY' ? 'INTERNAL' : 'D_COMPANY');
    expect(runs.size).toBe(2); expect(gmail.trashMessage).toHaveBeenCalledOnce();
  });

  it('accepts separate emails, applies both, and finalizes each once', async () => {
    messages = [mail('internal-mail', ['internal']), mail('d-mail', ['d'])];
    expect(await cycle()).toMatchObject({ processed: 2 });
    expect([...runs.keys()]).toEqual(['internal-mail:INTERNAL', 'd-mail:D_COMPANY']);
    expect(gmail.trashMessage.mock.calls).toEqual([['internal-mail'], ['d-mail']]);
    expect(gmail.markAsRead).toHaveBeenCalledTimes(2);
  });

  it('retries only the failed kind and keeps the email unread until both succeed', async () => {
    const realApply = apply.getMockImplementation()!;
    apply.mockImplementation(async (input) => {
      if (input.metadata.kind === 'INTERNAL') throw new Error('database unavailable');
      return realApply(input);
    });
    await expect(cycle()).rejects.toThrow('database unavailable');
    expect(runs.size).toBe(1); expect(gmail.trashMessage).not.toHaveBeenCalled(); expect(gmail.markAsRead).not.toHaveBeenCalled();
    apply.mockImplementation(realApply); apply.mockClear();
    await cycle();
    expect(apply).toHaveBeenCalledOnce(); expect(apply.mock.calls[0][0].metadata.kind).toBe('INTERNAL');
    expect(gmail.trashMessage).toHaveBeenCalledOnce(); expect(gmail.markAsRead).toHaveBeenCalledOnce();
  });

  it('processes the healthy attachment even if another has a permanent content failure', async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('1106結果');
    sheet.getCell('B1').value = new Date('2026-11-06Z'); sheet.addRow(['製番', '部品']);
    internalBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    messages = [mail('mail-1', ['internal', 'd'])];
    await expect(cycle()).rejects.toBeInstanceOf(DScheduleMinutesContentError);
    expect([...runs.keys()]).toEqual(['mail-1:D_COMPANY']);
    expect(gmail.trashMessage).not.toHaveBeenCalled(); expect(gmail.markAsRead).toHaveBeenCalledOnce();
  });

  it('does not mark read if permanent and transient attachment failures coexist', async () => {
    dBuffer = Buffer.from('unrelated');
    gmail.getAttachment.mockImplementation(async (_id: string, attachmentId: string) => {
      if (attachmentId === 'd') throw new Error('download unavailable');
      const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('1106結果');
      sheet.getCell('B1').value = new Date('2026-11-06Z'); sheet.addRow(['製番', '部品']);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    });
    await expect(cycle()).rejects.toMatchObject({ permanentFailures: [expect.stringContaining('ZERO_BLOCKS')], retryableFailures: [expect.stringContaining('download unavailable')] });
    expect(gmail.markAsRead).not.toHaveBeenCalled(); expect(gmail.trashMessage).not.toHaveBeenCalled();
  });
});
