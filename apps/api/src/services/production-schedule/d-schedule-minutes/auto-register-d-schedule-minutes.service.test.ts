import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { applyDScheduleMinutes } from './apply-d-schedule-minutes.service.js';
import { autoRegisterDScheduleMinutes } from './auto-register-d-schedule-minutes.service.js';
import type { DScheduleMinutesMetrics } from './import-summary.js';
import type { DScheduleMinutesBlock } from './parse-d-schedule-minutes.js';

const mocks = vi.hoisted(() => ({
  run: { id: 'current', kind: 'D_COMPANY', status: 'APPLIED', warnings: [] as unknown[], autoRegisteredSeibans: { planningBoards: {} as Record<string, string[]>, searchHistory: [] as string[], metrics: undefined as DScheduleMinutesMetrics | undefined } },
  newer: false,
  memberships: [] as { fseiban: string; kind: string; lastSourceRunId: string }[],
  previousMinutes: null as null | { sourceRun: { kind: string; meetingDate: Date }; partsCompleteDate: Date },
  membershipUpsert: vi.fn(),
  otherRuns: [] as { id: string; kind: string; status: string; meetingDate: Date; autoRegisteredSeibans: { planningBoards: Record<string, string[]>; searchHistory: string[] } }[],
  previous: null as null | { autoRegisteredSeibans: { planningBoards: Record<string, string[]>; searchHistory: string[] } },
  boards: {} as Record<string, { id: string; seibanOrder: string[]; uncheckedFseibans?: string[]; version: number }>,
  history: [] as string[],
  historyVersion: 1, sites: ['A', 'B'],
  minutes: [] as { fseiban: string; assigneesKnown: boolean; assignees: string[]; partsCompleteDate?: Date | null }[],
  readWinners: vi.fn(), rawRows: [] as { rowData: { FSEIBAN: string } }[],
  writeBoard: vi.fn(), writeHistory: vi.fn(), readBoard: vi.fn(), readHistory: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $transaction: (fn: (tx: unknown) => unknown) => fn({
    $executeRaw: vi.fn(),
    csvDashboardRow: { findFirst: ({ where }: { where: { rowData: { equals: string } } }) =>
      mocks.rawRows.find((row) => row.rowData.FSEIBAN === where.rowData.equals) },
    productionScheduleDScheduleMinutesImportRun: {
      findUnique: () => null, findFirst: () => null, create: () => mocks.run,
      update: ({ data }: { data: object }) => Object.assign(mocks.run, data)
    },
    productionScheduleDScheduleMinutes: { findUnique: () => mocks.previousMinutes, upsert: vi.fn() },
    productionScheduleDScheduleMinutesKindMembership: { findUnique: () => null, upsert: (...args: unknown[]) => mocks.membershipUpsert(...args) },
    productionScheduleSeibanDueDate: { findUnique: () => null }
  }),
  productionScheduleDScheduleMinutesImportRun: {
    findUniqueOrThrow: () => mocks.run,
    findFirst: ({ where }: { where: { kind: string; meetingDate?: unknown } }) => {
      const other = mocks.otherRuns.find((run) => run.kind === where.kind);
      if (where.kind !== mocks.run.kind) return other ?? null;
      return where.meetingDate ? (mocks.newer ? { id: 'newer' } : other) : mocks.previous ?? other;
    },
    update: vi.fn(({ where, data }: { where: { id: string }; data: object }) =>
      Object.assign(where.id === mocks.run.id ? mocks.run : mocks.otherRuns.find((run) => run.id === where.id)!, data))
  },
  productionScheduleDScheduleMinutes: { findMany: vi.fn(() => mocks.minutes) },
  productionScheduleDScheduleMinutesKindMembership: { findMany: vi.fn(({ where }: { where: { kind: string; lastSourceRunId: string } }) =>
    mocks.memberships.filter((row) => row.kind === where.kind && row.lastSourceRunId === where.lastSourceRunId)) },
  site: { findMany: () => mocks.sites.map((key) => ({ key })) },
  productionScheduleGrindingPlanningBoardState: { findMany: () => Object.entries(mocks.boards).map(([siteKey, board]) => ({ siteKey, seibanOrder: board.seibanOrder })) }
} }));
vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByFseibans: (...args: unknown[]) => mocks.readWinners(...args) }));
vi.mock('../grinding-planning-board/state.js', () => ({
  getOrCreateState: (...args: unknown[]) => mocks.readBoard(...args),
  boardRevision: (state: { version: number }) => String(state.version),
  stateOrder: (state: { seibanOrder: string[] }) => state.seibanOrder
}));
vi.mock('../grinding-planning-board/write.js', () => ({ updateGrindingPlanningBoardSeibanOrder: (...args: unknown[]) => mocks.writeBoard(...args) }));
vi.mock('../production-schedule-search-state.service.js', () => ({
  getProductionScheduleSearchState: (...args: unknown[]) => mocks.readHistory(...args),
  updateProductionScheduleSearchState: (...args: unknown[]) => mocks.writeHistory(...args)
}));
const block = (seiban: string, partsCompleteDate: string | null = '2026-11-10', aliases: string[] = []): DScheduleMinutesBlock => ({
  seiban, assignees: [], aliasSeibans: aliases, partsCompleteDate, outsourceMarks: [], surfaceSendOutDates: [], memo: null, sourceRow: 8, rawPartsCompleteText: null
});
const register = (blocks: DScheduleMinutesBlock[]) => autoRegisterDScheduleMinutes({ runId: 'current', blocks });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run = { id: 'current', kind: 'D_COMPANY', status: 'APPLIED', warnings: [], autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
  mocks.otherRuns = []; mocks.minutes = []; mocks.newer = false; mocks.previous = null; mocks.rawRows = []; mocks.readWinners.mockResolvedValue([]);
  mocks.memberships = []; mocks.previousMinutes = null;
  mocks.boards = { A: { id: 'A', seibanOrder: ['MANUAL-A'], version: 1 }, B: { id: 'B', seibanOrder: ['MANUAL-B'], version: 1 } };
  mocks.history = ['MANUAL-H']; mocks.historyVersion = 1; mocks.sites = ['A', 'B'];
  mocks.readBoard.mockImplementation((key: string) => mocks.boards[key]);
  mocks.readHistory.mockImplementation(() => ({ state: { history: mocks.history }, etag: String(mocks.historyVersion) }));
  mocks.writeBoard.mockImplementation(({ siteKey, fseibans, newUncheckedFseibans = [] }: { siteKey: string; fseibans: string[]; newUncheckedFseibans?: string[] }) => {
    const board = mocks.boards[siteKey];
    board.uncheckedFseibans = [...board.uncheckedFseibans ?? [], ...newUncheckedFseibans.filter((fseiban) => !board.seibanOrder.includes(fseiban))];
    mocks.boards[siteKey].seibanOrder = fseibans; mocks.boards[siteKey].version++;
  });
  mocks.writeHistory.mockImplementation(({ incomingHistory }: { incomingHistory: string[] }) => { mocks.history = incomingHistory; mocks.historyVersion++; });
});

describe('D schedule automatic registration', () => {
  it.each(['D_COMPANY', 'INTERNAL'])('reconciles legacy one-sided ownership against the other latest file: %s', async (kind) => {
    mocks.run.kind = kind;
    const otherKind = kind === 'INTERNAL' ? 'D_COMPANY' : 'INTERNAL';
    const owned = ['PRESENT', 'UNDATED', 'ABSENT', 'OLD-FILE'];
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: owned, B: owned }, searchHistory: owned } };
    mocks.otherRuns = [{ id: 'other-latest', kind: otherKind, status: 'SUCCESS', meetingDate: new Date('2026-11-06Z'),
      autoRegisteredSeibans: { planningBoards: {}, searchHistory: [] } }];
    // Presence is independent of dates and automatic ownership in the other file.
    mocks.memberships = [
      ...['PRESENT', 'UNDATED'].map((fseiban) => ({ fseiban, kind: otherKind, lastSourceRunId: 'other-latest' })),
      { fseiban: 'OLD-FILE', kind: otherKind, lastSourceRunId: 'other-older' },
      { fseiban: 'ABSENT', kind, lastSourceRunId: 'other-latest' }
    ];
    mocks.minutes = [{ fseiban: 'PRESENT', partsCompleteDate: new Date('2026-11-10Z'), assigneesKnown: false, assignees: [] },
      { fseiban: 'UNDATED', partsCompleteDate: null, assigneesKnown: false, assignees: [] }];
    for (const board of Object.values(mocks.boards)) board.seibanOrder.push(...owned);
    mocks.history.push(...owned);
    await register([]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'PRESENT', 'UNDATED']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B', 'PRESENT', 'UNDATED']);
    expect(mocks.history).toEqual(['MANUAL-H', 'PRESENT', 'UNDATED']);
    // Kept entries stay owned so they are removed once the other file drops them too.
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({
      planningBoards: { A: ['PRESENT', 'UNDATED'], B: ['PRESENT', 'UNDATED'] }, searchHistory: ['PRESENT', 'UNDATED']
    });
    expect(prisma.productionScheduleDScheduleMinutesKindMembership.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, kind: otherKind, lastSourceRunId: 'other-latest' }, select: { fseiban: true }
    });
  });

  it.each(['D_COMPANY', 'INTERNAL'])('does not take ownership of unowned entries that are only listed in the other file: %s', async (kind) => {
    mocks.run.kind = kind;
    const otherKind = kind === 'INTERNAL' ? 'D_COMPANY' : 'INTERNAL';
    mocks.otherRuns = [{ id: 'other', kind: otherKind, status: 'SUCCESS', meetingDate: new Date('2026-11-06Z'),
      autoRegisteredSeibans: { planningBoards: {}, searchHistory: [] } }];
    mocks.memberships = [{ fseiban: 'SHARED', kind: otherKind, lastSourceRunId: 'other' }];
    for (const board of Object.values(mocks.boards)) board.seibanOrder.push('SHARED');
    mocks.history.push('SHARED');
    await register([block('SHARED')]);
    // An entry no kind owns is treated as manual and must never become removable.
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: [], B: [] }, searchHistory: [] });
    expect(mocks.writeBoard).not.toHaveBeenCalled();
    expect(mocks.writeHistory).not.toHaveBeenCalled();
  });

  it.each(['D_COMPANY', 'INTERNAL'] as const)('warns NOT_IN_SCHEDULE on stale rows and completes all destinations: %s', async (kind) => {
    mocks.run.kind = kind;
    mocks.previousMinutes = { sourceRun: { kind: 'D_COMPANY', meetingDate: new Date('2026-11-06Z') }, partsCompleteDate: new Date('2026-11-10Z') };
    const writeBoard = mocks.writeBoard.getMockImplementation()!;
    mocks.writeBoard.mockImplementation((input: { siteKey: string; fseibans: string[] }) => {
      if (input.fseibans.includes('MISSING')) throw new ApiError(400, 'UNKNOWN_SEIBAN');
      return writeBoard(input);
    });
    const run = await applyDScheduleMinutes({
      result: { ok: true, assigneeColumnFound: true, meetingDate: '2026-10-30', blocks: [block('MISSING', undefined, ['ALIAS'])], warnings: [] },
      metadata: { kind, gmailMessageId: 'stale-missing', subject: 'test', filename: 'test.xlsx', receivedAt: new Date('2026-10-30Z') }
    });
    for (const seiban of ['MISSING', 'ALIAS']) {
      expect(run.warnings).toEqual(expect.arrayContaining([
        { code: 'NOT_IN_SCHEDULE', seiban, cell: 'B8', rawText: null },
        { code: 'STALE_FILE', seiban, cell: 'B8', rawText: null }
      ]));
      expect(mocks.membershipUpsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ fseiban: seiban, kind: mocks.run.kind, lastSourceRunId: 'current' })
      }));
    }
    expect(run.warnings).toHaveLength(4);
    expect(run.status).toBe('SUCCESS');
    expect(mocks.readBoard).toHaveBeenCalledTimes(2);
    expect(mocks.readHistory).toHaveBeenCalledTimes(2);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B']);
    expect(mocks.history).toEqual(['MANUAL-H']);
  });

  it.each([
    { first: 'INTERNAL', absent: true }, { first: 'D_COMPANY', absent: true },
    { first: 'INTERNAL', absent: false }, { first: 'D_COMPANY', absent: false }
  ])('retains a shared seiban after internal eligibility ends: %j', async ({ first, absent }) => {
    const ownerships: Record<string, typeof mocks.run.autoRegisteredSeibans> = {};
    const second = first === 'INTERNAL' ? 'D_COMPANY' : 'INTERNAL';
    for (const kind of [first, second]) {
      mocks.run = { ...mocks.run, kind, status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [],
        metrics: { seibansRead: 1, dateChanged: 0, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] } } };
      mocks.otherRuns = Object.entries(ownerships).map(([otherKind, autoRegisteredSeibans]) => ({
        id: otherKind, kind: otherKind, status: 'SUCCESS', meetingDate: new Date('2026-11-06Z'), autoRegisteredSeibans
      }));
      await register([block('SHARED')]);
      ownerships[kind] = structuredClone(mocks.run.autoRegisteredSeibans);
      if (kind === 'D_COMPANY' && kind === second) {
        expect(mocks.run.autoRegisteredSeibans.metrics).toMatchObject({ registeredSeibans: [], unregisteredSeibans: [] });
      }
    }
    expect(ownerships.D_COMPANY).toMatchObject({ planningBoards: { A: ['SHARED'], B: ['SHARED'] }, searchHistory: ['SHARED'] });
    mocks.previous = { autoRegisteredSeibans: ownerships.INTERNAL };
    mocks.otherRuns = [{ id: 'd', kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: new Date('2026-11-06Z'), autoRegisteredSeibans: ownerships.D_COMPANY }];
    mocks.run = { ...mocks.run, kind: 'INTERNAL', status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register(absent ? [] : [block('SHARED', null)]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'SHARED']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B', 'SHARED']);
    expect(mocks.history).toEqual(['MANUAL-H', 'SHARED']);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: absent ? [] : ['SHARED'], B: absent ? [] : ['SHARED'] }, searchHistory: absent ? [] : ['SHARED'] });
    expect(mocks.otherRuns[0]!.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: ['SHARED'], B: ['SHARED'] }, searchHistory: ['SHARED'] });
  });

  it('does not take ownership of manual entries listed in D company minutes', async () => {
    await register([block('MANUAL-H'), block('MANUAL-A')]);
    expect(mocks.run.autoRegisteredSeibans.searchHistory).not.toContain('MANUAL-H');
    expect(mocks.run.autoRegisteredSeibans.planningBoards.A ?? []).not.toContain('MANUAL-A');
    mocks.previous = { autoRegisteredSeibans: structuredClone(mocks.run.autoRegisteredSeibans) };
    mocks.run = { ...mocks.run, status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([]);
    expect(mocks.history).toContain('MANUAL-H');
    expect(mocks.boards.A.seibanOrder).toContain('MANUAL-A');
  });

  it('selects dated internal main/aliases in ascending date and block order, including past dates', async () => {
    mocks.run.kind = 'INTERNAL';
    const manual = Array.from({ length: 85 }, (_, i) => `M${i}`);
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...manual];
    mocks.history = [...manual];
    mocks.run.warnings = [{ code: 'NOT_IN_SCHEDULE', seiban: 'MISSING', cell: null, rawText: null }];
    await register([
      block('FUTURE', '2026-11-12'), block('SAME-1'), block('UNDATED', null, ['UNDATED-ALIAS']),
      block('PAST', '2026-10-01', ['PAST-ALIAS']), block('SAME-2'), block('MISSING', '2026-01-01'), block('FAR', '2027-01-01')
    ]);
    const selected = ['PAST', 'PAST-ALIAS', 'SAME-1', 'SAME-2', 'FUTURE', 'FAR'];
    expect(mocks.history).toEqual([...manual, ...selected]);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: selected, B: selected }, searchHistory: selected });
    expect(mocks.run.warnings).toEqual([{ code: 'NOT_IN_SCHEDULE', seiban: 'MISSING', cell: null, rawText: null }]);
  });

  it('keeps D company ownership and ignores its newer run when importing internal products, then alternates back', async () => {
    await register([block('D-ONLY')]);
    const dOwnership = structuredClone(mocks.run.autoRegisteredSeibans);
    mocks.otherRuns = [{ id: 'd-previous', kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'), autoRegisteredSeibans: dOwnership }];
    mocks.run = { ...mocks.run, kind: 'INTERNAL', status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([block('INTERNAL')]);
    expect(mocks.history).toEqual(['MANUAL-H', 'D-ONLY', 'INTERNAL']);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ searchHistory: ['INTERNAL'], planningBoards: { A: ['INTERNAL'], B: ['INTERNAL'] } });
    const internalOwnership = structuredClone(mocks.run.autoRegisteredSeibans);
    mocks.otherRuns.push({ id: 'internal-previous', kind: 'INTERNAL', status: 'SUCCESS', meetingDate: new Date('2026-11-08Z'), autoRegisteredSeibans: internalOwnership });
    mocks.previous = { autoRegisteredSeibans: dOwnership };
    mocks.otherRuns = mocks.otherRuns.filter((run) => run.kind !== 'D_COMPANY');
    mocks.run = { ...mocks.run, kind: 'D_COMPANY', status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([block('D-NEXT')]);
    expect(mocks.history).toEqual(['MANUAL-H', 'INTERNAL', 'D-NEXT']);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'INTERNAL', 'D-NEXT']);
  });

  it('applies a non-winner warning and finishes registration on every site and shared history', async () => {
    mocks.rawRows = ['SUPERSEDED', 'MAIN', 'ALIAS'].map((FSEIBAN) => ({ rowData: { FSEIBAN } }));
    mocks.readWinners.mockResolvedValue(mocks.rawRows.slice(1));
    const writeBoard = mocks.writeBoard.getMockImplementation()!;
    mocks.writeBoard.mockImplementation((input: { siteKey: string; fseibans: string[] }) => {
      if (input.fseibans.includes('SUPERSEDED')) throw new ApiError(400, 'UNKNOWN_SEIBAN');
      return writeBoard(input);
    });
    const run = await applyDScheduleMinutes({
      result: { ok: true, assigneeColumnFound: true, meetingDate: '2026-10-30', blocks: [block('SUPERSEDED'), block('MAIN', undefined, ['ALIAS'])], warnings: [] },
      metadata: { gmailMessageId: 'non-winner-import', subject: 'test', filename: '20261030 test.xlsx', receivedAt: new Date('2026-10-30Z') }
    });
    expect(mocks.readWinners).toHaveBeenCalledTimes(1);
    expect(mocks.readWinners.mock.calls[0]?.[1]).toEqual(['SUPERSEDED', 'MAIN', 'ALIAS']);
    expect(run.warnings).toEqual([{ code: 'NOT_IN_SCHEDULE', seiban: 'SUPERSEDED', cell: 'B8', rawText: null }]);
    expect(run.status).toBe('SUCCESS');
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'MAIN', 'ALIAS']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B', 'MAIN', 'ALIAS']);
    expect(mocks.history).toEqual(['MANUAL-H', 'MAIN', 'ALIAS']);
    expect(run.autoRegisteredSeibans).toEqual({ planningBoards: { A: ['MAIN', 'ALIAS'], B: ['MAIN', 'ALIAS'] }, searchHistory: ['MAIN', 'ALIAS'], metrics: { seibansRead: 3, dateChanged: 3, unchanged: 0, registeredSeibans: ['MAIN', 'ALIAS'], unregisteredSeibans: [] } });
  });

  it('unchecks only new known non-machine seibans, retaining both existing check states', async () => {
    mocks.boards.A.seibanOrder.push('CHECKED', 'UNCHECKED');
    mocks.boards.A.uncheckedFseibans = ['UNCHECKED'];
    mocks.minutes = [
      { fseiban: 'CHECKED', assigneesKnown: true, assignees: ['組立課'] },
      { fseiban: 'UNCHECKED', assigneesKnown: true, assignees: ['機械課'] },
      { fseiban: 'NEW-NON-MACHINE', assigneesKnown: true, assignees: ['組立課'] },
      { fseiban: 'NEW-MACHINE', assigneesKnown: true, assignees: ['機械課'] },
      { fseiban: 'UNKNOWN', assigneesKnown: false, assignees: [] }
    ];
    await register(mocks.minutes.map((row) => block(row.fseiban)));
    expect(mocks.boards.A.uncheckedFseibans).toEqual(['UNCHECKED', 'NEW-NON-MACHINE']);
    expect(mocks.boards.B.uncheckedFseibans).toEqual(['CHECKED', 'NEW-NON-MACHINE']);
  });

  it('skips registration for an older file, records why, and retains successful ownership', async () => {
    mocks.newer = true;
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: ['NEWER'] }, searchHistory: ['NEWER'] } };
    mocks.boards.A.seibanOrder.push('NEWER'); mocks.history.push('NEWER');
    await register([block('OLD')]);
    expect(mocks.writeBoard).not.toHaveBeenCalled(); expect(mocks.writeHistory).not.toHaveBeenCalled();
    expect(mocks.run.status).toBe('SUCCESS');
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({
      planningBoards: { A: ['NEWER'] }, searchHistory: ['NEWER'], autoRegistrationSkipped: 'STALE_FILE'
    });
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'NEWER']);
    expect(mocks.history).toEqual(['MANUAL-H', 'NEWER']);
  });

  it('retains unique registration/removal metrics across an APPLIED retry', async () => {
    mocks.run.autoRegisteredSeibans.metrics = { seibansRead: 1, dateChanged: 1, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] };
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: ['STALE'], B: ['STALE'] }, searchHistory: ['STALE'] } };
    mocks.boards.A.seibanOrder.push('STALE'); mocks.boards.B.seibanOrder.push('STALE'); mocks.history.push('STALE');
    const writeBoard = mocks.writeBoard.getMockImplementation()!;
    let failed = false;
    mocks.writeBoard.mockImplementation((input: { siteKey: string; fseibans: string[] }) => {
      if (input.siteKey === 'B' && !failed) { failed = true; throw new Error('destination unavailable'); }
      return writeBoard(input);
    });
    await expect(register([block('MAIN')])).rejects.toThrow('destination unavailable');
    expect(mocks.run.status).toBe('APPLIED');
    expect(mocks.run.autoRegisteredSeibans.metrics).toMatchObject({ registeredSeibans: ['MAIN'], unregisteredSeibans: ['STALE'] });
    await register([block('MAIN')]);
    expect(mocks.run.status).toBe('SUCCESS');
    expect(mocks.run.autoRegisteredSeibans.metrics).toEqual({ seibansRead: 1, dateChanged: 1, unchanged: 0, registeredSeibans: ['MAIN'], unregisteredSeibans: ['STALE'] });
  });

  it('adds main/alias to every site and shared history, excluding NOT_IN_SCHEDULE', async () => {
    mocks.run.warnings = [{ code: 'NOT_IN_SCHEDULE', seiban: 'MISSING', cell: null, rawText: null }];
    await register([block('MAIN', undefined, ['ALIAS']), block('MISSING')]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'MAIN', 'ALIAS']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B', 'MAIN', 'ALIAS']);
    expect(mocks.history).toEqual(['MANUAL-H', 'MAIN', 'ALIAS']);
    expect(mocks.run.autoRegisteredSeibans).toEqual({ planningBoards: { A: ['MAIN', 'ALIAS'], B: ['MAIN', 'ALIAS'] }, searchHistory: ['MAIN', 'ALIAS'] });
  });

  it('removes absent auto entries from boards and history while retaining manual entries', async () => {
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: ['STALE', 'KEEP'], B: ['KEEP'] }, searchHistory: ['STALE', 'KEEP'] } };
    mocks.boards.A.seibanOrder.push('STALE', 'KEEP');
    mocks.boards.B.seibanOrder.push('STALE', 'KEEP'); // STALE was manual at B.
    mocks.history.push('STALE', 'KEEP');
    await register([block('KEEP')]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'KEEP']);
    expect(mocks.run.autoRegisteredSeibans.planningBoards.A).toEqual(['KEEP']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B', 'STALE', 'KEEP']);
    expect(mocks.history).toEqual(['MANUAL-H', 'KEEP']);
    expect(mocks.run.autoRegisteredSeibans.searchHistory).toEqual(['KEEP']);
  });

  it.each(['BLOCK_SHAPE', 'DUPLICATE_SEIBAN', 'UNREADABLE_ALIAS', 'FORMULA_NO_RESULT'])('retains warning-only ownership for %s until truly absent without adding warning-only keys', async (code) => {
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: ['SKIPPED'], B: ['SKIPPED'] }, searchHistory: ['SKIPPED'] } };
    mocks.boards.A.seibanOrder.push('SKIPPED'); mocks.boards.B.seibanOrder.push('SKIPPED'); mocks.history.push('SKIPPED');
    mocks.run.warnings = ['SKIPPED', 'NEW-SKIPPED', null].map((seiban) => ({ code, seiban, cell: 'B8', rawText: null }));
    await register([block('KEEP')]);
    for (const board of Object.values(mocks.boards)) expect(board.seibanOrder).toContain('SKIPPED');
    expect(mocks.history).toEqual(['MANUAL-H', 'SKIPPED', 'KEEP']);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: ['SKIPPED', 'KEEP'], B: ['SKIPPED', 'KEEP'] }, searchHistory: ['SKIPPED', 'KEEP'] });
    for (const board of Object.values(mocks.boards)) expect(board.seibanOrder).not.toContain('NEW-SKIPPED');

    mocks.previous = { autoRegisteredSeibans: structuredClone(mocks.run.autoRegisteredSeibans) };
    mocks.run = { ...mocks.run, status: 'APPLIED', warnings: [], autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([block('KEEP')]);
    for (const board of Object.values(mocks.boards)) expect(board.seibanOrder).not.toContain('SKIPPED');
    expect(mocks.history).toEqual(['MANUAL-H', 'KEEP']);
    expect(mocks.run.autoRegisteredSeibans.searchHistory).toEqual(['KEEP']);
  });

  it('retains ownership of shared auto entries copied into a newly initialized site', async () => {
    mocks.previous = { autoRegisteredSeibans: { planningBoards: {}, searchHistory: ['STALE'] } };
    mocks.history.push('STALE'); mocks.sites.push('NEW');
    mocks.readBoard.mockImplementation((key: string) => {
      mocks.boards[key] ??= { id: key, seibanOrder: [...mocks.history], version: 1 };
      return mocks.boards[key];
    });
    await register([block('MAIN')]);
    expect(mocks.boards.NEW.seibanOrder).toEqual(['MANUAL-H', 'MAIN']);
    expect(mocks.run.autoRegisteredSeibans.planningBoards.NEW).toEqual(['MAIN']);
  });

  it('is a no-op on replay, also across a new message with unchanged entries', async () => {
    await register([block('MAIN')]);
    const writes = mocks.writeBoard.mock.calls.length + mocks.writeHistory.mock.calls.length;
    await register([block('MAIN')]);
    mocks.previous = { autoRegisteredSeibans: structuredClone(mocks.run.autoRegisteredSeibans) };
    mocks.run = { ...mocks.run, status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([block('MAIN')]);
    expect(mocks.writeBoard.mock.calls.length + mocks.writeHistory.mock.calls.length).toBe(writes);
    expect(mocks.run.autoRegisteredSeibans.searchHistory).toEqual(['MAIN']);
  });

  it('re-reads and retries once on each destination conflict, preserving concurrent manual entries', async () => {
    mocks.writeBoard.mockImplementationOnce(() => { mocks.boards.A.seibanOrder.push('CONCURRENT-A'); throw new ApiError(409, 'conflict'); });
    mocks.writeHistory.mockImplementationOnce(() => { mocks.history.push('CONCURRENT-H'); throw new ApiError(409, 'conflict'); });
    await register([block('MAIN')]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'CONCURRENT-A', 'MAIN']);
    expect(mocks.history).toEqual(['MANUAL-H', 'CONCURRENT-H', 'MAIN']);
    expect(mocks.readBoard).toHaveBeenCalledTimes(3);
    expect(mocks.readHistory).toHaveBeenCalledTimes(3);
  });

  it('propagates a second conflict without declaring success', async () => {
    mocks.writeBoard.mockRejectedValue(new ApiError(409, 'conflict'));
    await expect(register([block('MAIN')])).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.writeBoard).toHaveBeenCalledTimes(2);
    expect(mocks.run.status).toBe('APPLIED');
  });
  it.each([false, true])('registers 73 D company + 200 internal entries in either import order (empty=%s)', async (empty) => {
    const d = Array.from({ length: 73 }, (_, i) => block(`D${i}`, new Date(Date.UTC(2026, 0, i * 2 + 1)).toISOString().slice(0, 10)));
    const internal = Array.from({ length: 200 }, (_, i) => block(`I${i}`, new Date(Date.UTC(2026, 0, i * 2 + 2)).toISOString().slice(0, 10)));
    const all = [...d, ...internal];
    mocks.minutes = all.map((entry) => ({ fseiban: entry.seiban, partsCompleteDate: new Date(entry.partsCompleteDate!), assigneesKnown: false, assignees: [] }));
    const results: { boards: Record<string, string[]>; history: string[] }[] = [];
    for (const order of [['D_COMPANY', 'INTERNAL'], ['INTERNAL', 'D_COMPANY']]) {
      for (const [key, board] of Object.entries(mocks.boards)) board.seibanOrder = empty ? [] : [`MANUAL-${key}`];
      mocks.history = empty ? [] : ['MANUAL-H']; mocks.previous = null; mocks.otherRuns = [];
      for (const kind of order) {
        mocks.run = { ...mocks.run, kind, status: 'APPLIED', warnings: [], autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
        await register(kind === 'INTERNAL' ? internal : d);
        mocks.otherRuns.push({ id: kind, kind, status: 'SUCCESS', meetingDate: new Date('2026-11-06Z'), autoRegisteredSeibans: structuredClone(mocks.run.autoRegisteredSeibans) });
        expect(mocks.run.warnings).toEqual([]);
      }
      expect(mocks.history).toHaveLength(273 + (empty ? 0 : 1));
      for (const board of Object.values(mocks.boards)) expect(board.seibanOrder).toHaveLength(273 + (empty ? 0 : 1));
      results.push({ boards: Object.fromEntries(Object.entries(mocks.boards).map(([key, board]) => [key, board.seibanOrder])), history: mocks.history });
    }
    expect(results[0]).toEqual(results[1]);
    expect(prisma.productionScheduleDScheduleMinutes.findMany).toHaveBeenCalledTimes(4);
    expect(vi.mocked(prisma.productionScheduleDScheduleMinutes.findMany).mock.calls[1]![0]).toMatchObject({
      where: { fseiban: { in: expect.arrayContaining(all.map((entry) => entry.seiban)) } }
    });
  });

  it.each(['D_COMPANY', 'INTERNAL'])('inserts all eligible additions by date without moving existing entries: %s', async (kind) => {
    mocks.run.kind = kind;
    const current = ['MANUAL', 'LATER', 'EARLIER', 'NO-DATE'];
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...current];
    mocks.history = [...current];
    const incoming = [block('MIDDLE', '2026-11-10'), block('FIRST', '2026-11-01'), block('UNDATED', null)];
    mocks.minutes = [...incoming, block('LATER', '2026-11-20'), block('EARLIER', '2026-11-05')].map((entry) => ({
      fseiban: entry.seiban, partsCompleteDate: entry.partsCompleteDate ? new Date(entry.partsCompleteDate) : null,
      assigneesKnown: false, assignees: []
    }));
    await register(incoming);
    const expected = ['MANUAL', 'FIRST', 'MIDDLE', 'LATER', 'EARLIER', 'NO-DATE', ...(kind === 'D_COMPANY' ? ['UNDATED'] : [])];
    expect(mocks.history).toEqual(expected);
    for (const board of Object.values(mocks.boards)) expect(board.seibanOrder).toEqual(expected);
    expect(prisma.productionScheduleDScheduleMinutes.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(['D_COMPANY', 'INTERNAL'])('releases only its ownership until both kinds drop a seiban: %s', async (kind) => {
    const owned = { planningBoards: { A: ['SHARED', 'ABSENT', 'SAVED'], B: ['SHARED', 'ABSENT', 'SAVED'] }, searchHistory: ['SHARED', 'ABSENT', 'SAVED'] };
    mocks.run.kind = kind;
    mocks.previous = { autoRegisteredSeibans: { ...owned, planningBoards: { A: ['SHARED', 'ABSENT'], B: ['SHARED', 'ABSENT'] }, searchHistory: ['SHARED', 'ABSENT'] } };
    mocks.run.autoRegisteredSeibans = { planningBoards: { A: ['SAVED'], B: ['SAVED'] }, searchHistory: ['SAVED'], metrics: undefined };
    mocks.otherRuns = [{ id: 'other', kind: kind === 'INTERNAL' ? 'D_COMPANY' : 'INTERNAL', status: 'SUCCESS', meetingDate: new Date('2026-11-06Z'),
      autoRegisteredSeibans: { planningBoards: { A: ['SHARED'], B: ['SHARED'] }, searchHistory: ['SHARED'] } }];
    for (const board of Object.values(mocks.boards)) board.seibanOrder.push('SHARED', 'ABSENT', 'SAVED');
    mocks.history.push('SHARED', 'ABSENT', 'SAVED');
    const otherBefore = structuredClone(mocks.otherRuns);
    await register([]);
    for (const board of Object.values(mocks.boards)) {
      expect(board.seibanOrder).toContain('SHARED');
      expect(board.seibanOrder).not.toContain('ABSENT'); expect(board.seibanOrder).not.toContain('SAVED');
    }
    expect(mocks.history).toEqual(['MANUAL-H', 'SHARED']);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: [], B: [] }, searchHistory: [] });
    expect(mocks.otherRuns).toEqual(otherBefore);
    mocks.previous = { autoRegisteredSeibans: otherBefore[0]!.autoRegisteredSeibans };
    mocks.otherRuns = [];
    mocks.run = { ...mocks.run, kind: otherBefore[0]!.kind, status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([]);
    expect(mocks.history).toEqual(['MANUAL-H']);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A']); expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B']);
  });

});
