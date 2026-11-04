import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BOARD_DUE_JOINS_SQL, BOARD_MANUAL_UPDATED_AT_SQL } from './board-due.sql.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { defaultBackupConfig } from '../../backup/backup-config.js';
import { DScheduleMinutesGmailIngestionService } from './d-schedule-minutes-gmail-ingestion.service.js';
import { applyDScheduleMinutes } from './apply-d-schedule-minutes.service.js';
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
async function apply(blocks: DScheduleMinutesBlock[], message = randomUUID(), meetingDate = '2026-10-30') {
  const run = await applyDScheduleMinutes({ result: { ok: true, meetingDate, blocks, warnings: [] },
    metadata: { gmailMessageId: message, subject: 'synthetic D minutes', filename: '20261030 test.xlsx', receivedAt: new Date('2026-10-30Z') } });
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
});
