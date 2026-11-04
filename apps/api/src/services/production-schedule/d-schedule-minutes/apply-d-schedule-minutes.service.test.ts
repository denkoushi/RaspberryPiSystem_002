import { randomUUID } from 'node:crypto';
import type { Prisma, ProductionScheduleDScheduleMinutesImportRun } from '@prisma/client';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BOARD_DUE_JOINS_SQL, BOARD_MANUAL_UPDATED_AT_SQL } from './board-due.sql.js';
import { prisma } from '../../../lib/prisma.js';
import * as scheduleSource from '../grinding-planning-board/source.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { defaultBackupConfig } from '../../backup/backup-config.js';
import { DScheduleMinutesGmailIngestionService } from './d-schedule-minutes-gmail-ingestion.service.js';
import { applyDScheduleMinutes, DScheduleMinutesComparisonError } from './apply-d-schedule-minutes.service.js';
import { summarizeMinutes } from './import-summary.js';
import type { DScheduleMinutesBlock } from './parse-d-schedule-minutes.js';

vi.mock('./auto-register-d-schedule-minutes.service.js', () => ({ autoRegisterDScheduleMinutes: vi.fn() }));
const local = /^postgresql:\/\/[^@]+@(?:localhost|127\.0\.0\.1):5432\/borrow_return(?:\?|$)/.test(process.env.DATABASE_URL ?? '');
const runIds: string[] = [];
const seibans: string[] = [];
const rowIds: string[] = [];
function block(overrides: Partial<DScheduleMinutesBlock> = {}): DScheduleMinutesBlock {
  const seiban = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  seibans.push(seiban);
  return { seiban, aliasSeibans: [], partsCompleteDate: '2026-11-10', outsourceMarks: ['X'],
    surfaceSendOutDates: [{ date: '2026-11-02', label: '★LSLH処理出', note: null }], memo: 'test memo',
    sourceRow: 8, rawPartsCompleteText: '11/10(X)', ...overrides };
}
async function apply(blocks: DScheduleMinutesBlock[], message: string = randomUUID(), meetingDate = '2026-10-30', thresholds?: Parameters<typeof applyDScheduleMinutes>[0]['thresholds']) {
  const run = await applyDScheduleMinutes({ result: { ok: true, meetingDate, blocks, warnings: [] },
    metadata: { gmailMessageId: message, subject: 'synthetic D minutes', filename: '20261030 test.xlsx', receivedAt: new Date('2026-10-30Z') }, thresholds });
  runIds.push(run.id);
  return run;
}
const latest = (fseiban: string) => prisma.productionScheduleDScheduleMinutes.findUniqueOrThrow({
  where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban } }
});

describe.skipIf(!local)('apply D schedule minutes on the local test DB', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID }, update: {},
      create: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'Test production schedule', columnDefinitions: [], templateConfig: {} } });
  });
  afterEach(async () => {
    await prisma.productionScheduleDScheduleMinutes.deleteMany({ where: { fseiban: { in: seibans } } });
    await prisma.productionScheduleDScheduleMinutesImportRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { fseiban: { in: seibans } } });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    runIds.length = 0; seibans.length = 0; rowIds.length = 0;
  });

  it('persists aliases, warns about missing schedule/manual due, and never writes existing due/note authorities', async () => {
    const alias = block().seiban;
    const main = block({ aliasSeibans: [alias] });
    const row = await prisma.csvDashboardRow.create({ data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(), rowData: { FSEIBAN: main.seiban } } });
    rowIds.push(row.id);
    const manual = await prisma.productionScheduleSeibanDueDate.create({ data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: main.seiban, dueDate: new Date('2026-11-20Z')
    } });
    const note = await prisma.productionScheduleRowNote.create({ data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id, dueDate: manual.dueDate, note: 'unchanged' } });
    const run = await apply([main]);
    expect(run.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NOT_IN_SCHEDULE', seiban: alias }),
      expect.objectContaining({ code: 'MANUAL_DUE_EXISTS_FIRST_TIME', seiban: main.seiban })
    ]));
    expect(await latest(alias)).toMatchObject({ isAlias: true, aliasOf: main.seiban, partsCompleteDate: new Date('2026-11-10Z') });
    expect(await prisma.productionScheduleSeibanDueDate.findUnique({ where: { id: manual.id } })).toEqual(manual);
    expect(await prisma.productionScheduleRowNote.findUnique({ where: { id: note.id } })).toEqual(note);
    expect(await prisma.productionScheduleSeibanProcessingDueDate.count({ where: { fseiban: main.seiban } })).toBe(0);
    // A note-only edit must not become the manual due's authority timestamp.
    await prisma.productionScheduleRowNote.update({ where: { id: note.id }, data: { note: 'later note edit', updatedAt: new Date('2026-12-01Z') } });
    const authority = await prisma.$queryRaw<Array<{ manualUpdatedAt: Date | null }>>`
      SELECT ${BOARD_MANUAL_UPDATED_AT_SQL} AS "manualUpdatedAt" FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleRowNote" AS "n" ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      ${BOARD_DUE_JOINS_SQL}
      WHERE "CsvDashboardRow"."id" = ${row.id}
    `;
    expect(authority[0]?.manualUpdatedAt).toEqual(manual.updatedAt);
  });

  it('keeps every latest row byte-for-byte on identical content, including a different email', async () => {
    const main = block();
    const id = randomUUID();
    await apply([main], id);
    const before = await latest(main.seiban);
    await apply([main], id);
    const repeated = await apply([main]);
    expect(repeated.autoRegisteredSeibans).toMatchObject({ metrics: { seibansRead: 1, dateChanged: 0, unchanged: 1 } });
    expect(await latest(main.seiban)).toEqual(before);
  });

  it('preserves newer rows and emits one STALE_FILE per seiban without date counts', async () => {
    const main = block();
    await apply([main], randomUUID(), '2026-11-06');
    const before = await latest(main.seiban);
    const stale = await apply([{ ...main, partsCompleteDate: '2026-11-01' }]);
    expect(await latest(main.seiban)).toEqual(before);
    expect(stale.warnings).toEqual([{ code: 'STALE_FILE', seiban: main.seiban, cell: 'B8', rawText: main.rawPartsCompleteText }]);
    expect(stale.autoRegisteredSeibans).toMatchObject({ metrics: { seibansRead: 1, dateChanged: 0, unchanged: 0 } });
    await apply([{ ...main, partsCompleteDate: '2026-11-12' }], randomUUID(), '2026-11-06');
    expect((await latest(main.seiban)).partsCompleteDate).toEqual(new Date('2026-11-12Z'));
  });

  it('applies unread messages returned newest-first oldest-first so newer dates win', async () => {
    const main = block();
    const oldId = randomUUID(); const newId = randomUUID();
    const order: string[] = [];
    const gmail = {
      searchMessagesLimited: vi.fn().mockResolvedValue([newId, oldId]),
      getMessage: vi.fn(async (id: string) => ({ id, threadId: id, labelIds: ['UNREAD'], snippet: '',
        internalDateMs: Date.parse(id === oldId ? '2026-10-30Z' : '2026-11-06Z'),
        payload: { headers: [{ name: 'Subject', value: 'D社日程会議議事録' }],
          parts: [{ filename: `${id} 日程会議議事録.xlsx`, body: { attachmentId: id } }] }
      })),
      getAttachment: vi.fn(async () => Buffer.from('synthetic workbook')),
      trashMessage: vi.fn(), markAsRead: vi.fn()
    };
    const ingestion = new DScheduleMinutesGmailIngestionService({
      gmailFactory: vi.fn().mockResolvedValue(gmail), db: prisma,
      saveOriginal: vi.fn().mockResolvedValue('synthetic.xlsx'), notify: vi.fn(),
      parse: vi.fn(async ({ filename }) => ({ ok: true as const, meetingDate: filename.startsWith(oldId) ? '2026-10-30' : '2026-11-06',
        blocks: [{ ...main, partsCompleteDate: filename.startsWith(oldId) ? '2026-11-01' : '2026-11-12' }], warnings: [] })),
      apply: async (input) => {
        order.push(input.metadata.gmailMessageId);
        const run = await applyDScheduleMinutes(input); runIds.push(run.id); return run;
      }
    });
    const summary = await ingestion.runOnce({ config: defaultBackupConfig, allowWait: false });
    expect(order).toEqual([oldId, newId]); expect(summary.processed).toBe(2);
    expect((await latest(main.seiban)).partsCompleteDate).toEqual(new Date('2026-11-12Z'));
    expect(gmail.trashMessage.mock.calls).toEqual([[oldId], [newId]]);
    expect(gmail.markAsRead.mock.calls).toEqual([[oldId], [newId]]);
  });

  it('moves excelChangedAt only for changed dates and never touches absent seibans', async () => {
    const main = block(); const absent = block();
    await apply([main, absent]);
    const before = await latest(main.seiban); const absentBefore = await latest(absent.seiban);
    await apply([{ ...main, memo: 'changed metadata' }]);
    expect((await latest(main.seiban)).excelChangedAt).toEqual(before.excelChangedAt);
    await apply([{ ...main, partsCompleteDate: '2026-11-12' }]);
    const after = await latest(main.seiban);
    expect(after.partsCompleteDate).toEqual(new Date('2026-11-12Z'));
    expect(after.excelChangedAt.getTime()).toBeGreaterThan(before.excelChangedAt.getTime());
    expect(await latest(absent.seiban)).toEqual(absentBefore);
  });

  it.each(['seiban count', 'large date changes'])('rolls back %s failure without a run or any data changes', async (failure) => {
    const originals = Array.from({ length: 4 }, () => block());
    const previous = await apply(originals);
    await prisma.productionScheduleDScheduleMinutesImportRun.update({ where: { id: previous.id }, data: { status: 'SUCCESS' } });
    const before = await Promise.all(originals.map((entry) => latest(entry.seiban)));
    const messageId = randomUUID();
    const fresh = block();
    const incoming = failure === 'seiban count' ? [{ ...originals[0], memo: 'must not write' }]
      : [...originals.map((entry) => ({ ...entry, partsCompleteDate: '2027-01-09' })), fresh];
    await expect(apply(incoming, messageId, '2026-11-06', { minCompared: 1 })).rejects.toBeInstanceOf(DScheduleMinutesComparisonError);
    expect(await prisma.productionScheduleDScheduleMinutesImportRun.findUnique({ where: { gmailMessageId: messageId } })).toBeNull();
    expect(await Promise.all(originals.map((entry) => latest(entry.seiban)))).toEqual(before);
    expect(await prisma.productionScheduleDScheduleMinutes.count({ where: { fseiban: fresh.seiban } })).toBe(0);
  });
});


describe('apply D schedule minutes date preservation', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([null, 'unreadable', '2026-02-30'])('preserves stored due and excelChangedAt for incoming %s while updating metadata', async (partsCompleteDate) => {
    const main = block({ partsCompleteDate, memo: 'updated memo', rawPartsCompleteText: partsCompleteDate });
    const before = { ...main, partsCompleteDate: new Date('2026-11-10Z'), memo: 'previous memo',
      excelChangedAt: new Date('2026-10-30Z'), sourceRun: { meetingDate: new Date('2026-10-30Z') },
      isAlias: false, aliasOf: null };
    const run = { id: 'synthetic-run', status: 'APPLIED', meetingDate: new Date('2026-11-06Z') } as ProductionScheduleDScheduleMinutesImportRun;
    const upsert = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue(run);
    const tx = {
      $executeRaw: vi.fn(),
      productionScheduleDScheduleMinutesImportRun: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(run), update },
      productionScheduleDScheduleMinutes: { findUnique: vi.fn().mockResolvedValue(before), upsert },
    };
    vi.spyOn(scheduleSource, 'readWinnerRowsByFseibans').mockResolvedValue([]);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (operation) => {
      if (typeof operation !== 'function') throw new Error('Expected interactive transaction');
      return operation(tx as unknown as Prisma.TransactionClient);
    });
    vi.spyOn(prisma.productionScheduleDScheduleMinutesImportRun, 'findUniqueOrThrow').mockResolvedValue(run);
    await apply([main], 'synthetic-message', '2026-11-06');
    expect(upsert).toHaveBeenCalledOnce();
    const values = upsert.mock.calls[0][0].update;
    expect(values.partsCompleteDate).toEqual(before.partsCompleteDate);
    expect(values).not.toHaveProperty('excelChangedAt');
    expect(values.memo).toBe('updated memo');
    expect(update.mock.calls[0][0].data.autoRegisteredSeibans.metrics).toMatchObject({ dateChanged: 0, unchanged: 1 });
    if (partsCompleteDate) expect(update.mock.calls[0][0].data.warnings).toContainEqual(expect.objectContaining({ code: 'UNREADABLE_DATE' }));
  });
});

describe('apply D schedule minutes comparison before writes', () => {
  afterEach(() => vi.restoreAllMocks());

  function harness(blocks: DScheduleMinutesBlock[], previousCount: number | null = 10, storedDate: string | null = '2026-11-10') {
    const run = { id: 'comparison-run', status: 'APPLIED', meetingDate: new Date('2026-11-06Z') } as ProductionScheduleDScheduleMinutesImportRun;
    const tx = {
      $executeRaw: vi.fn(),
      productionScheduleDScheduleMinutesImportRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(previousCount === null ? null : { autoRegisteredSeibans: { metrics: { seibansRead: previousCount } } }),
        create: vi.fn().mockResolvedValue(run),
        update: vi.fn().mockImplementation(({ data }) => Object.assign(run, data))
      },
      productionScheduleDScheduleMinutes: {
        findUnique: vi.fn().mockResolvedValue({ partsCompleteDate: storedDate ? new Date(`${storedDate}T00:00:00Z`) : null,
          sourceRun: { meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null }),
        upsert: vi.fn()
      }
    };
    vi.spyOn(scheduleSource, 'readWinnerRowsByFseibans').mockResolvedValue(blocks.map((entry) => ({
      id: entry.seiban, updatedAt: new Date('2026-10-30Z'), rowData: { FSEIBAN: entry.seiban }
    })));
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (operation) => {
      if (typeof operation !== 'function') throw new Error('Expected interactive transaction');
      return operation(tx as unknown as Prisma.TransactionClient);
    });
    vi.spyOn(prisma.productionScheduleDScheduleMinutesImportRun, 'findUniqueOrThrow').mockResolvedValue(run);
    return { tx, run, execute: (thresholds?: Parameters<typeof applyDScheduleMinutes>[0]['thresholds']) => applyDScheduleMinutes({
      result: { ok: true, meetingDate: '2026-11-06', blocks, warnings: [] },
      metadata: { gmailMessageId: 'comparison-mail', subject: 'test', filename: 'test.xlsx', receivedAt: new Date('2026-11-06Z') }, thresholds
    }) };
  }

  it('rejects a drop in distinct main/alias count before creating any run or row', async () => {
    const { tx, execute } = harness([block({ aliasSeibans: ['ALIAS001', 'ALIAS001'] })], 5);
    await expect(execute()).rejects.toThrow('前回より製番が大きく減りました: 前回5件, 今回2件');
    expect(tx.productionScheduleDScheduleMinutesImportRun.create).not.toHaveBeenCalled();
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
    expect(tx.productionScheduleDScheduleMinutesImportRun.findFirst).toHaveBeenCalledWith({
      where: { status: 'SUCCESS', meetingDate: { lt: new Date('2026-11-06Z') } },
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.productionScheduleDScheduleMinutesImportRun.findUnique.mock.invocationCallOrder[0]!);
  });

  it('rejects too many absolute date changes including exactly 60 days without writing anything', async () => {
    const blocks = Array.from({ length: 10 }, (_, index) => block({ partsCompleteDate: index < 2 ? '2026-09-11' : index < 4 ? '2027-01-09' : '2026-11-10' }));
    const { tx, execute } = harness(blocks);
    await expect(execute()).rejects.toThrow('60日以上変わった製番が多すぎます: 4/10件');
    expect(tx.productionScheduleDScheduleMinutesImportRun.create).not.toHaveBeenCalled();
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
  });

  it('writes one large change at the allowed ratio and counts it as a warning, not skipped', async () => {
    const main = block({ partsCompleteDate: '2027-01-09' });
    const blocks = [main, ...Array.from({ length: 9 }, () => block())];
    const { tx, run, execute } = harness(blocks);
    await execute({ maxLargeChangeRatio: 0.1 });
    expect(tx.productionScheduleDScheduleMinutes.upsert.mock.calls[0][0].update.partsCompleteDate).toEqual(new Date('2027-01-09Z'));
    const warnings = [{ code: 'LARGE_DUE_CHANGE', seiban: main.seiban, cell: 'B8', rawText: '2026-11-10→2027-01-09' }];
    expect(run.warnings).toEqual(warnings);
    expect(summarizeMinutes(undefined, warnings)).toMatchObject({ skipped: 0, warnings });
  });

  it('skips comparisons on the first successful import even if stored dates exist', async () => {
    const { tx, run, execute } = harness([block({ partsCompleteDate: '2027-01-09' })], null);
    await execute({ minCompared: 1, maxLargeChangeRatio: 0 });
    expect(tx.productionScheduleDScheduleMinutes.upsert).toHaveBeenCalledOnce();
    expect(run.warnings).toEqual([]);
  });

  it('keeps a single large change below MIN_COMPARED and honors a custom day threshold', async () => {
    const { tx, run, execute } = harness([block({ partsCompleteDate: '2026-11-11' })], 1);
    await execute({ largeChangeDays: 1, minCompared: 2, maxLargeChangeRatio: 0 });
    expect(tx.productionScheduleDScheduleMinutes.upsert).toHaveBeenCalledOnce();
    expect(run.warnings).toEqual([expect.objectContaining({ code: 'LARGE_DUE_CHANGE' })]);
  });

  it('accepts exactly the minimum distinct count, including aliases', async () => {
    const { tx, execute } = harness([block({ aliasSeibans: ['ALIAS001'] })], 4);
    await execute();
    expect(tx.productionScheduleDScheduleMinutes.upsert).toHaveBeenCalledTimes(2);
  });

  it('excludes missing stored and unreadable incoming dates from the denominator', async () => {
    const blocks = [block({ partsCompleteDate: '2027-01-09' }), block({ partsCompleteDate: '2026-02-30' }), block()];
    const { tx, execute } = harness(blocks, 3);
    tx.productionScheduleDScheduleMinutes.findUnique.mockResolvedValueOnce({ partsCompleteDate: new Date('2026-11-10Z'),
      sourceRun: { meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null })
      .mockResolvedValueOnce({ partsCompleteDate: new Date('2026-11-10Z'), sourceRun: { meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null })
      .mockResolvedValueOnce({ partsCompleteDate: null, sourceRun: { meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null });
    await expect(execute({ minCompared: 1, maxLargeChangeRatio: 0.5 })).rejects.toThrow('1/1件');
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
  });

  it('returns an existing SUCCESS run before comparison queries', async () => {
    const { tx, run, execute } = harness([block()], 100);
    run.status = 'SUCCESS';
    tx.productionScheduleDScheduleMinutesImportRun.findUnique.mockResolvedValue(run);
    await execute();
    expect(tx.productionScheduleDScheduleMinutesImportRun.findFirst).not.toHaveBeenCalled();
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
  });
});
