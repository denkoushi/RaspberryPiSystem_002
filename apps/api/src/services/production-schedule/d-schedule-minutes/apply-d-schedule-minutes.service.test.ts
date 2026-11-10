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
import type { DScheduleMinutesKind } from './minutes-kind.js';
import { summarizeMinutes } from './import-summary.js';
import type { DScheduleMinutesBlock } from './parse-d-schedule-minutes.js';

vi.mock('./auto-register-d-schedule-minutes.service.js', () => ({ autoRegisterDScheduleMinutes: vi.fn() }));
const local = /^postgresql:\/\/[^@]+@(?:localhost|127\.0\.0\.1):5432\/borrow_return(?:\?|$)/.test(process.env.DATABASE_URL ?? '') || (process.env.TEST_DATABASE_URL === 'postgresql://postgres:postgres@127.0.0.1:55432/sessaku_test' && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL);
const runIds: string[] = [];
const seibans: string[] = [];
const rowIds: string[] = [];
function block(overrides: Partial<DScheduleMinutesBlock> = {}): DScheduleMinutesBlock {
  const seiban = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  seibans.push(seiban);
  return { seiban, assignees: [], aliasSeibans: [], partsCompleteDate: '2026-11-10', outsourceMarks: ['X'],
    surfaceSendOutDates: [{ date: '2026-11-02', label: '★LSLH処理出', note: null }], memo: 'test memo',
    sourceRow: 8, rawPartsCompleteText: '11/10(X)', ...overrides };
}
async function apply(blocks: DScheduleMinutesBlock[], message: string = randomUUID(), meetingDate = '2026-10-30', thresholds?: Parameters<typeof applyDScheduleMinutes>[0]['thresholds']) {
  const run = await applyDScheduleMinutes({ result: { ok: true, assigneeColumnFound: true, meetingDate, blocks, warnings: [] },
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
    await prisma.productionScheduleDScheduleMinutesKindMembership.deleteMany({ where: { fseiban: { in: seibans } } });
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
        payload: { headers: [{ name: 'Subject', value: 'D社日程会議議事録' }, { name: 'From', value: 'synthetic@example.com' },
          { name: 'Authentication-Results', value: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass' }],
          parts: [{ filename: `${id} 日程会議議事録.xlsx`, body: { attachmentId: id } }] }
      })),
      getAttachment: vi.fn(async () => Buffer.from('synthetic workbook')),
      trashMessage: vi.fn(), markAsRead: vi.fn()
    };
    const ingestion = new DScheduleMinutesGmailIngestionService({
      gmailFactory: vi.fn().mockResolvedValue(gmail), db: prisma,
      saveOriginal: vi.fn().mockResolvedValue('synthetic.xlsx'), notify: vi.fn(),
      parse: vi.fn(async ({ filename }) => ({ ok: true as const, assigneeColumnFound: true, meetingDate: filename.startsWith(oldId) ? '2026-10-30' : '2026-11-06',
        blocks: [{ ...main, partsCompleteDate: filename.startsWith(oldId) ? '2026-11-01' : '2026-11-12' }], warnings: [] })),
      apply: async (input) => {
        order.push(input.metadata.gmailMessageId);
        const run = await applyDScheduleMinutes(input); runIds.push(run.id); return run;
      }
    });
    const summary = await ingestion.runOnce({ config: { ...defaultBackupConfig, gmailIngestSenderPolicy: { allowedSenderDomains: ['example.com'] } }, allowWait: false });
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
    expect(await prisma.productionScheduleDScheduleMinutesImportRun.findUnique({ where: { gmailMessageId_kind: { gmailMessageId: messageId, kind: 'D_COMPANY' } } })).toBeNull();
    expect(await Promise.all(originals.map((entry) => latest(entry.seiban)))).toEqual(before);
    expect(await prisma.productionScheduleDScheduleMinutes.count({ where: { fseiban: fresh.seiban } })).toBe(0);
  });
});


describe('apply D schedule minutes date preservation', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([null, 'unreadable', '2026-02-30'])('preserves stored due and excelChangedAt for incoming %s while updating metadata', async (partsCompleteDate) => {
    const main = block({ partsCompleteDate, memo: 'updated memo', rawPartsCompleteText: partsCompleteDate });
    const before = { ...main, partsCompleteDate: new Date('2026-11-10Z'), memo: 'previous memo',
      excelChangedAt: new Date('2026-10-30Z'), sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-10-30Z') },
      isAlias: false, aliasOf: null };
    const run = { id: 'synthetic-run', status: 'APPLIED', meetingDate: new Date('2026-11-06Z') } as ProductionScheduleDScheduleMinutesImportRun;
    const upsert = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue(run);
    const tx = {
      $executeRaw: vi.fn(),
      productionScheduleDScheduleMinutesKindMembership: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
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
      productionScheduleDScheduleMinutesKindMembership: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      productionScheduleDScheduleMinutesImportRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(previousCount === null ? null : { autoRegisteredSeibans: { metrics: { seibansRead: previousCount } } }),
        create: vi.fn().mockResolvedValue(run),
        update: vi.fn().mockImplementation(({ data }) => Object.assign(run, data))
      },
      productionScheduleDScheduleMinutes: {
        findUnique: vi.fn().mockResolvedValue({ partsCompleteDate: storedDate ? new Date(`${storedDate}T00:00:00Z`) : null,
          sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null }),
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
    return { tx, run, execute: (thresholds?: Parameters<typeof applyDScheduleMinutes>[0]['thresholds'], kind: DScheduleMinutesKind = 'D_COMPANY') => applyDScheduleMinutes({
      result: { ok: true, assigneeColumnFound: true, meetingDate: '2026-11-06', blocks, warnings: [] },
      metadata: { kind, gmailMessageId: 'comparison-mail', subject: 'test', filename: 'test.xlsx', receivedAt: new Date('2026-11-06Z') }, thresholds
    }) };
  }

  it.each([
    { assignees: ['資材課'], assigneesKnown: true },
    { assignees: ['機械課・資材課'], assigneesKnown: false }
  ])('updates an assignee-only change from %j', async (stored) => {
    const main = block({ assignees: ['機械課・資材課'] });
    const { tx, execute } = harness([main], null);
    tx.productionScheduleDScheduleMinutes.findUnique.mockResolvedValue({
      ...main, ...stored, partsCompleteDate: new Date('2026-11-10Z'),
      sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-10-30Z') }, isAlias: false, aliasOf: null
    });
    await execute();
    expect(tx.productionScheduleDScheduleMinutes.upsert).toHaveBeenCalledOnce();
    expect(tx.productionScheduleDScheduleMinutes.upsert.mock.calls[0][0].update).toMatchObject({
      assignees: main.assignees, assigneesKnown: true
    });
    expect(tx.productionScheduleDScheduleMinutes.upsert.mock.calls[0][0].update).not.toHaveProperty('excelChangedAt');
  });

  it('rejects a drop in distinct main/alias count before creating any run or row', async () => {
    const { tx, execute } = harness([block({ aliasSeibans: ['ALIAS001', 'ALIAS001'] })], 5);
    await expect(execute()).rejects.toThrow('前回より製番が大きく減りました: 前回5件, 今回2件');
    expect(tx.productionScheduleDScheduleMinutesImportRun.create).not.toHaveBeenCalled();
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
    expect(tx.productionScheduleDScheduleMinutesImportRun.findFirst).toHaveBeenCalledWith({
      where: { kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: { lt: new Date('2026-11-06Z') } },
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
      sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null })
      .mockResolvedValueOnce({ partsCompleteDate: new Date('2026-11-10Z'), sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null })
      .mockResolvedValueOnce({ partsCompleteDate: null, sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-10-30Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null });
    await expect(execute({ minCompared: 1, maxLargeChangeRatio: 0.5 })).rejects.toThrow('1/1件');
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
  });

  it('uses compound run identity and same-kind comparisons without comparing another kind’s latest value', async () => {
    const { tx, execute } = harness([block({ partsCompleteDate: '2027-01-09' })], 1);
    await execute({ minCompared: 1, maxLargeChangeRatio: 0 }, 'INTERNAL');
    expect(tx.productionScheduleDScheduleMinutesImportRun.findUnique).toHaveBeenCalledWith({
      where: { gmailMessageId_kind: { gmailMessageId: 'comparison-mail', kind: 'INTERNAL' } }
    });
    expect(tx.productionScheduleDScheduleMinutesImportRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: 'INTERNAL', status: 'SUCCESS', meetingDate: { lt: new Date('2026-11-06Z') } }
    }));
    expect(tx.productionScheduleDScheduleMinutesImportRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'INTERNAL' }) }));
    expect(tx.productionScheduleDScheduleMinutes.upsert).toHaveBeenCalledOnce();
  });

  it('keeps a newer shared value from the other kind while recording the internal run', async () => {
    const { tx, run, execute } = harness([block()], null);
    tx.productionScheduleDScheduleMinutes.findUnique.mockResolvedValue({ partsCompleteDate: new Date('2026-11-15Z'),
      sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-11-07Z') }, outsourceMarks: [], surfaceSendOutDates: [], memo: null });
    await execute(undefined, 'INTERNAL');
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
    expect(run.warnings).toEqual([expect.objectContaining({ code: 'STALE_FILE' })]);
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


describe('apply D schedule minutes kind memberships', () => {
  afterEach(() => vi.restoreAllMocks());

  function harness() {
    const memberships = new Map<string, { lastSourceRunId: string; lastMeetingDate: Date }>();
    const membership = {
      findUnique: vi.fn(async ({ where }) => memberships.get(JSON.stringify(where.csvDashboardId_fseiban_kind)) ?? null),
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = JSON.stringify(where.csvDashboardId_fseiban_kind);
        memberships.set(key, memberships.has(key) ? { ...memberships.get(key)!, ...update } : create);
      })
    };
    let run: ProductionScheduleDScheduleMinutesImportRun;
    const tx = {
      $executeRaw: vi.fn(),
      productionScheduleDScheduleMinutesKindMembership: membership,
      productionScheduleDScheduleMinutesImportRun: {
        findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => (run = { ...data, id: randomUUID() })),
        update: vi.fn(async () => run)
      },
      // Every latest-value write is stale: membership must still be recorded.
      productionScheduleDScheduleMinutes: {
        findUnique: vi.fn().mockResolvedValue({ sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-12-01Z') } }),
        upsert: vi.fn()
      }
    };
    vi.spyOn(scheduleSource, 'readWinnerRowsByFseibans').mockResolvedValue([]);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (operation) => {
      if (typeof operation !== 'function') throw new Error('Expected interactive transaction');
      return operation(tx as unknown as Prisma.TransactionClient);
    });
    vi.spyOn(prisma.productionScheduleDScheduleMinutesImportRun, 'findUniqueOrThrow').mockImplementation(async () => run);
    return { tx, memberships, execute: (blocks: DScheduleMinutesBlock[], kind: DScheduleMinutesKind, meetingDate = '2026-11-06', warningSeibans: Array<string | null> = []) => applyDScheduleMinutes({
      result: { ok: true, assigneeColumnFound: true, meetingDate, blocks,
        warnings: warningSeibans.map((seiban) => ({ code: 'UNREADABLE_DATE', seiban, cell: null, rawText: null })) },
      metadata: { kind, gmailMessageId: randomUUID(), subject: 'test', filename: 'test.xlsx', receivedAt: new Date('2026-11-06Z') }
    }) };
  }

  it('keeps two memberships for the same seiban even when latest values are stale', async () => {
    const { tx, memberships, execute } = harness();
    const main = block();
    const d = await execute([main], 'D_COMPANY');
    const internal = await execute([main], 'INTERNAL');
    expect([...memberships.values()]).toEqual([
      expect.objectContaining({ kind: 'D_COMPANY', fseiban: main.seiban, lastSourceRunId: d.id }),
      expect.objectContaining({ kind: 'INTERNAL', fseiban: main.seiban, lastSourceRunId: internal.id })
    ]);
    expect(tx.productionScheduleDScheduleMinutes.upsert).not.toHaveBeenCalled();
  });

  it('preserves newer membership, updates on equal/newer dates, and retains absent seibans', async () => {
    const { tx, memberships, execute } = harness();
    const main = block();
    const first = await execute([main], 'INTERNAL');
    await execute([main], 'INTERNAL', '2026-10-30');
    expect([...memberships.values()]).toEqual([expect.objectContaining({ lastSourceRunId: first.id, lastMeetingDate: new Date('2026-11-06Z') })]);
    expect(tx.productionScheduleDScheduleMinutesKindMembership.upsert).toHaveBeenCalledTimes(1);
    const equal = await execute([main], 'INTERNAL');
    expect([...memberships.values()][0].lastSourceRunId).toBe(equal.id);
    const newer = await execute([main], 'INTERNAL', '2026-11-07');
    await execute([], 'INTERNAL', '2026-11-08');
    expect([...memberships.values()]).toEqual([expect.objectContaining({ lastSourceRunId: newer.id, lastMeetingDate: new Date('2026-11-07Z') })]);
  });

  it('includes aliases and warning-only seibans once and ignores warnings without seiban', async () => {
    const { tx, memberships, execute } = harness();
    const main = block({ aliasSeibans: ['ALIAS001', 'ALIAS001'] });
    await execute([main], 'D_COMPANY', '2026-11-06', ['SKIPPED001', 'ALIAS001', null]);
    expect([...memberships.values()]).toEqual([
      expect.objectContaining({ fseiban: main.seiban }),
      expect.objectContaining({ fseiban: 'ALIAS001' }),
      expect.objectContaining({ fseiban: 'SKIPPED001' })
    ]);
    expect(tx.productionScheduleDScheduleMinutesKindMembership.upsert).toHaveBeenCalledTimes(3);
  });
});

describe('apply shared seibans from both minutes kinds', () => {
  afterEach(() => vi.restoreAllMocks());

  function harness(main: DScheduleMinutesBlock) {
    type Stored = Omit<DScheduleMinutesBlock, 'partsCompleteDate'> & {
      partsCompleteDate: Date | null; assigneesKnown: boolean; sourceRunId: string;
      sourceRun: { kind: DScheduleMinutesKind; meetingDate: Date }; excelChangedAt: Date;
      isAlias: boolean; aliasOf: string | null;
    };
    let stored: Stored | null = null;
    let run: ProductionScheduleDScheduleMinutesImportRun;
    const memberships = new Map<string, { lastMeetingDate: Date }>();
    const tx = {
      $executeRaw: vi.fn(),
      productionScheduleDScheduleMinutesKindMembership: {
        findUnique: vi.fn(async ({ where }) => memberships.get(where.csvDashboardId_fseiban_kind.kind) ?? null),
        upsert: vi.fn(async ({ create }) => { memberships.set(create.kind, create); })
      },
      productionScheduleDScheduleMinutesImportRun: {
        findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => (run = { ...data, id: randomUUID() })),
        update: vi.fn(async ({ data }) => Object.assign(run, data))
      },
      productionScheduleDScheduleMinutes: {
        findUnique: vi.fn(async () => stored),
        upsert: vi.fn(async ({ create, update }) => {
          stored = { ...stored, ...(stored ? update : create),
            sourceRun: !stored || update.sourceRunId ? { kind: run.kind, meetingDate: run.meetingDate } : stored.sourceRun };
        })
      },
      productionScheduleSeibanDueDate: { findUnique: vi.fn().mockResolvedValue(null) }
    };
    vi.spyOn(scheduleSource, 'readWinnerRowsByFseibans').mockResolvedValue([
      { id: main.seiban, updatedAt: new Date('2026-10-30Z'), rowData: { FSEIBAN: main.seiban } }
    ]);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (operation) => {
      if (typeof operation !== 'function') throw new Error('Expected interactive transaction');
      return operation(tx as unknown as Prisma.TransactionClient);
    });
    vi.spyOn(prisma.productionScheduleDScheduleMinutesImportRun, 'findUniqueOrThrow').mockImplementation(async () => run);
    return { tx, latest: () => stored!, execute: (kind: DScheduleMinutesKind, meetingDate: string, entry = main) => applyDScheduleMinutes({
      result: { ok: true, assigneeColumnFound: kind === 'D_COMPANY', meetingDate, blocks: [entry], warnings: [] },
      metadata: { kind, gmailMessageId: randomUUID(), subject: 'test', filename: 'test.xlsx', receivedAt: new Date('2026-11-09Z') }
    }) };
  }

  it.each(['D_COMPANY', 'INTERNAL'] as const)('keeps D-only fields and the newest shared date when %s arrives first', async (first) => {
    const d = block({ assignees: ['機械課'] });
    const internal = { ...d, assignees: [], outsourceMarks: [], surfaceSendOutDates: [], memo: null,
      partsCompleteDate: '2026-11-15', rawPartsCompleteText: '11/15', sourceRow: 12 };
    const { tx, latest, execute } = harness(d);
    const importKind = (kind: DScheduleMinutesKind) => execute(kind, kind === 'D_COMPANY' ? '2026-11-06' : '2026-11-07', kind === 'D_COMPANY' ? d : internal);
    await importKind(first);
    const before = latest();
    if (first === 'INTERNAL') expect(before).toMatchObject({ assignees: [], assigneesKnown: false, outsourceMarks: [], surfaceSendOutDates: [], memo: null });
    const second = await importKind(first === 'D_COMPANY' ? 'INTERNAL' : 'D_COMPANY');
    expect(latest()).toMatchObject({ assignees: d.assignees, assigneesKnown: true, outsourceMarks: d.outsourceMarks,
      surfaceSendOutDates: d.surfaceSendOutDates, memo: d.memo, partsCompleteDate: new Date('2026-11-15Z'),
      rawPartsCompleteText: '11/15', sourceRow: 12, sourceRun: { kind: 'INTERNAL', meetingDate: new Date('2026-11-07Z') } });
    expect(second.warnings).toEqual([]);
    expect(second.autoRegisteredSeibans).toMatchObject({ metrics: { dateChanged: first === 'INTERNAL' ? 0 : 1, unchanged: first === 'INTERNAL' ? 1 : 0 } });
    if (first === 'INTERNAL') {
      expect(latest().sourceRunId).toBe(before.sourceRunId);
      expect(latest().excelChangedAt).toEqual(before.excelChangedAt);
      expect(tx.productionScheduleDScheduleMinutes.upsert.mock.lastCall![0].update).not.toHaveProperty('sourceRunId');
      expect(tx.productionScheduleDScheduleMinutes.upsert.mock.lastCall![0].update).not.toHaveProperty('excelChangedAt');
      expect(tx.productionScheduleDScheduleMinutes.upsert.mock.lastCall![0].update).not.toHaveProperty('partsCompleteDate');
      expect(tx.productionScheduleDScheduleMinutes.upsert.mock.lastCall![0].update).not.toHaveProperty('rawPartsCompleteText');
    } else {
      const update = tx.productionScheduleDScheduleMinutes.upsert.mock.lastCall![0].update;
      for (const field of ['assignees', 'assigneesKnown', 'outsourceMarks', 'surfaceSendOutDates', 'memo']) {
        expect(update).not.toHaveProperty(field);
      }
    }

    const settled = latest(); const writes = tx.productionScheduleDScheduleMinutes.upsert.mock.calls.length;
    const repeated = await importKind('D_COMPANY');
    expect(latest()).toEqual(settled);
    expect(tx.productionScheduleDScheduleMinutes.upsert).toHaveBeenCalledTimes(writes);
    expect(repeated.warnings).toEqual([]);
    expect(repeated.autoRegisteredSeibans).toMatchObject({ metrics: { dateChanged: 0, unchanged: 1 } });

    const stale = await execute('D_COMPANY', '2026-11-05', { ...d, memo: 'stale', partsCompleteDate: '2026-11-01' });
    expect(latest()).toEqual(settled);
    expect(stale.warnings).toEqual([expect.objectContaining({ code: 'STALE_FILE' })]);
    expect(stale.autoRegisteredSeibans).toMatchObject({ metrics: { dateChanged: 0, unchanged: 0 } });

    await execute('D_COMPANY', '2026-11-08', { ...d, memo: 'new D', partsCompleteDate: '2026-11-16', rawPartsCompleteText: '11/16' });
    expect(latest()).toMatchObject({ partsCompleteDate: new Date('2026-11-16Z'), memo: 'new D', sourceRun: { kind: 'D_COMPANY' } });
    await execute('INTERNAL', '2026-11-09', { ...internal, partsCompleteDate: '2026-11-17' });
    expect(latest()).toMatchObject({ partsCompleteDate: new Date('2026-11-17Z'), memo: 'new D', assignees: d.assignees,
      assigneesKnown: true, outsourceMarks: d.outsourceMarks, surfaceSendOutDates: d.surfaceSendOutDates });
  });

  it('advances shared provenance for newer identical content without moving excelChangedAt', async () => {
    const d = block({ assignees: ['機械課'] });
    const { execute, latest, tx } = harness(d);
    await execute('D_COMPANY', '2026-11-06');
    const before = latest();
    const internal = await execute('INTERNAL', '2026-11-09', { ...d, assignees: [], outsourceMarks: [], surfaceSendOutDates: [], memo: null });
    expect(latest()).toMatchObject({ sourceRunId: internal.id, excelChangedAt: before.excelChangedAt });
    expect(tx.productionScheduleDScheduleMinutes.upsert.mock.lastCall![0].update).not.toHaveProperty('excelChangedAt');
    await execute('D_COMPANY', '2026-11-08', { ...d, partsCompleteDate: '2026-11-18', memo: 'new D metadata' });
    expect(latest()).toMatchObject({ partsCompleteDate: before.partsCompleteDate, rawPartsCompleteText: before.rawPartsCompleteText,
      sourceRunId: internal.id, excelChangedAt: before.excelChangedAt, memo: 'new D metadata' });
  });

  it('uses the D membership before its upsert when a newer D-only update precedes an older D file', async () => {
    const d = block({ assignees: ['機械課'] });
    const { execute, latest } = harness(d);
    await execute('INTERNAL', '2026-11-09', { ...d, partsCompleteDate: '2026-11-20', rawPartsCompleteText: '11/20', assignees: [], outsourceMarks: [], surfaceSendOutDates: [], memo: null });
    await execute('D_COMPANY', '2026-11-07', { ...d, memo: 'newer D' });
    const before = latest();
    const stale = await execute('D_COMPANY', '2026-11-06', d);
    expect(latest()).toEqual(before);
    expect(stale.warnings).toEqual([expect.objectContaining({ code: 'STALE_FILE' })]);
    expect(latest()).toMatchObject({ memo: 'newer D', partsCompleteDate: new Date('2026-11-20Z') });
  });
});
