import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { applyDScheduleMinutes } from './apply-d-schedule-minutes.service.js';
import { autoRegisterDScheduleMinutes } from './auto-register-d-schedule-minutes.service.js';
import type { DScheduleMinutesMetrics } from './import-summary.js';
import type { DScheduleMinutesBlock } from './parse-d-schedule-minutes.js';

const mocks = vi.hoisted(() => ({
  run: { id: 'current', kind: 'D_COMPANY', status: 'APPLIED', warnings: [] as unknown[], autoRegisteredSeibans: { planningBoards: {} as Record<string, string[]>, searchHistory: [] as string[], metrics: undefined as DScheduleMinutesMetrics | undefined } },
  newer: false,
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
    productionScheduleDScheduleMinutes: { findUnique: () => null, upsert: vi.fn() },
    productionScheduleDScheduleMinutesKindMembership: { findUnique: () => null, upsert: vi.fn() },
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
  productionScheduleDScheduleMinutes: { findMany: () => mocks.minutes },
  site: { findMany: () => mocks.sites.map((key) => ({ key })) },
  productionScheduleGrindingPlanningBoardState: { findMany: () => Object.keys(mocks.boards).map((siteKey) => ({ siteKey })) }
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
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: [], B: [] }, searchHistory: [] });
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

  it('budgets internal entries per destination after D company, manual entries and ten reserved slots', async () => {
    mocks.run.kind = 'INTERNAL';
    const manual = Array.from({ length: 89 }, (_, i) => `M${i}`);
    mocks.boards.A.seibanOrder = [...manual.slice(0, 85), 'D1', 'D2'];
    mocks.boards.B.seibanOrder = [...manual.slice(0, 88), 'D1'];
    mocks.history = [...manual, 'D1', 'D2'];
    mocks.otherRuns = [{ id: 'd', kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'),
      autoRegisteredSeibans: { planningBoards: { A: ['D1', 'D2', 'ABSENT'], B: ['D1'] }, searchHistory: ['D1', 'D2'] } }];
    await register(['D1', 'D2', 'M0', 'I1', 'I2', 'I3', 'I4'].map((seiban) => block(seiban)));
    expect(mocks.run.autoRegisteredSeibans.planningBoards).toEqual({ A: ['I1', 'I2', 'I3'], B: ['D2'] });
    expect(mocks.run.autoRegisteredSeibans.searchHistory).toEqual([]);
    expect(mocks.boards.A.seibanOrder).toHaveLength(90);
    expect(mocks.boards.B.seibanOrder).toHaveLength(90);
    expect(mocks.history).toHaveLength(91);
    expect(mocks.run.warnings).toEqual([]);
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
    const selected = ['PAST', 'PAST-ALIAS', 'SAME-1', 'SAME-2', 'FUTURE'];
    expect(mocks.history).toEqual([...manual, ...selected]);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: selected, B: selected }, searchHistory: selected });
    expect(mocks.run.warnings).toEqual([{ code: 'NOT_IN_SCHEDULE', seiban: 'MISSING', cell: null, rawText: null }]);
  });

  it('removes internal entries that disappear, lose dates or fall outside next week slots while keeping manual and D entries', async () => {
    mocks.run.kind = 'INTERNAL';
    mocks.run.autoRegisteredSeibans.metrics = { seibansRead: 5, dateChanged: 0, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] };
    const manual = Array.from({ length: 87 }, (_, i) => `M${i}`);
    const old = ['ABSENT', 'UNDATED', 'LATE', 'KEEP'];
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...manual, 'D', ...old, 'SAVED'];
    mocks.history = [...mocks.boards.A.seibanOrder];
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: old, B: old.filter((seiban) => seiban !== 'LATE') }, searchHistory: old } };
    mocks.run.autoRegisteredSeibans.planningBoards = { A: ['SAVED'], B: ['SAVED'] };
    mocks.run.autoRegisteredSeibans.searchHistory = ['SAVED'];
    mocks.otherRuns = [{ id: 'd', kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'),
      autoRegisteredSeibans: { planningBoards: { A: ['D'], B: ['D'] }, searchHistory: ['D'] } }];
    await register([block('LATE', '2026-12-01'), block('UNDATED', null), block('KEEP'), block('NEW', '2026-10-01')]);
    expect(mocks.boards.A.seibanOrder).toEqual([...manual, 'D', 'KEEP', 'NEW']);
    expect(mocks.boards.B.seibanOrder).toEqual([...manual, 'D', 'LATE', 'NEW']);
    expect(mocks.history).toEqual([...manual, 'D', 'KEEP', 'NEW']);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: ['KEEP', 'NEW'], B: ['NEW'] }, searchHistory: ['KEEP', 'NEW'] });
    expect(mocks.run.autoRegisteredSeibans.metrics).toMatchObject({ registeredSeibans: ['NEW'], unregisteredSeibans: ['ABSENT', 'UNDATED', 'LATE', 'SAVED', 'KEEP'] });
  });

  it('evicts only internal automatic entries farthest first when D company needs space and releases their ownership', async () => {
    const manual = Array.from({ length: 96 }, (_, i) => `M${i}`);
    const internal = ['NEAR', 'FAR', 'MIDDLE'];
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...manual, ...internal];
    mocks.history = [...manual, 'EXTRA-MANUAL', ...internal];
    mocks.otherRuns = [{ id: 'internal', kind: 'INTERNAL', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'),
      autoRegisteredSeibans: { planningBoards: { A: [...internal], B: ['NEAR'] }, searchHistory: [...internal] } }];
    mocks.minutes = internal.map((fseiban, i) => ({ fseiban, assigneesKnown: false, assignees: [],
      partsCompleteDate: new Date(['2026-11-01Z', '2026-12-01Z', '2026-11-15Z'][i]!) }));
    await register([block('D1'), block('D2')]);
    expect(mocks.boards.A.seibanOrder).toEqual([...manual, 'NEAR', 'MIDDLE', 'D1', 'D2']);
    expect(mocks.boards.B.seibanOrder).toEqual([...manual, 'FAR', 'MIDDLE', 'D1', 'D2']);
    expect(mocks.history).toEqual([...manual, 'EXTRA-MANUAL', 'NEAR', 'D1', 'D2']);
    expect(mocks.otherRuns[0]!.autoRegisteredSeibans).toEqual({ planningBoards: { A: ['NEAR', 'MIDDLE'], B: [] }, searchHistory: ['NEAR'] });
    expect(prisma.productionScheduleDScheduleMinutesImportRun.update).toHaveBeenCalledWith({
      where: { id: 'internal' }, data: { autoRegisteredSeibans: mocks.otherRuns[0]!.autoRegisteredSeibans }
    });
    expect(mocks.run.warnings).toEqual([]);

    // A subsequent manual re-registration must no longer belong to the internal import.
    mocks.boards.A.seibanOrder = mocks.boards.A.seibanOrder.filter((seiban) => seiban !== 'M0');
    mocks.boards.A.seibanOrder.push('FAR');
    mocks.history = mocks.history.filter((seiban) => seiban !== 'M0'); mocks.history.push('FAR');
    mocks.previous = { autoRegisteredSeibans: structuredClone(mocks.otherRuns[0]!.autoRegisteredSeibans) };
    mocks.otherRuns = [{ id: 'd', kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: new Date('2026-11-08Z'), autoRegisteredSeibans: structuredClone(mocks.run.autoRegisteredSeibans) }];
    mocks.run = { ...mocks.run, kind: 'INTERNAL', status: 'APPLIED', autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
    await register([block('FAR', null)]);
    expect(mocks.boards.A.seibanOrder).toContain('FAR');
    expect(mocks.history).toContain('FAR');
    expect(mocks.run.autoRegisteredSeibans.searchHistory).toEqual([]);
  });

  it('recalculates internal slots on conflicts and keeps saved ownership through partial retries', async () => {
    mocks.run.kind = 'INTERNAL';
    const manual = Array.from({ length: 88 }, (_, i) => `M${i}`);
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...manual];
    mocks.history = [...manual];
    const writeBoard = mocks.writeBoard.getMockImplementation()!;
    let failed = false;
    mocks.writeBoard.mockImplementation((input: { siteKey: string; fseibans: string[] }) => {
      if (input.siteKey === 'B' && !failed) { failed = true; throw new Error('unavailable'); }
      return writeBoard(input);
    });
    mocks.writeBoard.mockImplementationOnce(() => { mocks.boards.A.seibanOrder.push('CONCURRENT'); throw new ApiError(409, 'conflict'); });
    await expect(register([block('NEAR'), block('FAR', '2026-12-01')])).rejects.toThrow('unavailable');
    expect(mocks.run.autoRegisteredSeibans.planningBoards.A).toEqual(['NEAR']);
    await register([block('NEAR'), block('FAR', '2026-12-01')]);
    expect(mocks.boards.A.seibanOrder).toEqual([...manual, 'CONCURRENT', 'NEAR']);
    expect(mocks.run.autoRegisteredSeibans).toMatchObject({ planningBoards: { A: ['NEAR'], B: ['NEAR', 'FAR'] }, searchHistory: ['NEAR', 'FAR'] });
  });

  it('reconciles inherited internal ownership on a new site and protects inherited D company entries', async () => {
    mocks.run.kind = 'INTERNAL';
    mocks.previous = { autoRegisteredSeibans: { planningBoards: {}, searchHistory: ['OLD'] } };
    mocks.otherRuns = [{ id: 'd', kind: 'D_COMPANY', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'),
      autoRegisteredSeibans: { planningBoards: {}, searchHistory: ['D'] } }];
    mocks.history.push('OLD', 'D'); mocks.sites.push('NEW');
    mocks.readBoard.mockImplementation((key: string) => {
      mocks.boards[key] ??= { id: key, seibanOrder: [...mocks.history], version: 1 };
      return mocks.boards[key];
    });
    await register([block('MAIN'), block('D')]);
    expect(mocks.boards.NEW.seibanOrder).toEqual(['MANUAL-H', 'D', 'MAIN']);
    expect(mocks.run.autoRegisteredSeibans.planningBoards.NEW).toEqual(['MAIN']);
  });

  it('recomputes D company evictions after a conflict and saves internal ownership per completed destination', async () => {
    const manual = Array.from({ length: 97 }, (_, i) => `M${i}`);
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...manual, 'NEAR', 'FAR'];
    mocks.history = [...manual, 'NEAR', 'FAR'];
    mocks.otherRuns = [{ id: 'internal', kind: 'INTERNAL', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'),
      autoRegisteredSeibans: { planningBoards: { A: ['NEAR', 'FAR'], B: ['NEAR', 'FAR'] }, searchHistory: ['NEAR', 'FAR'] } }];
    mocks.minutes = ['NEAR', 'FAR'].map((fseiban, i) => ({ fseiban, assigneesKnown: false, assignees: [],
      partsCompleteDate: new Date(i ? '2026-12-01Z' : '2026-11-01Z') }));
    const writeBoard = mocks.writeBoard.getMockImplementation()!;
    let failed = false;
    mocks.writeBoard.mockImplementation((input: { siteKey: string; fseibans: string[] }) => {
      if (input.siteKey === 'B' && !failed) { failed = true; throw new Error('unavailable'); }
      return writeBoard(input);
    });
    mocks.writeBoard.mockImplementationOnce(() => { mocks.boards.A.seibanOrder.push('CONCURRENT'); throw new ApiError(409, 'conflict'); });
    await expect(register([block('D1'), block('D2')])).rejects.toThrow('unavailable');
    expect(mocks.otherRuns[0]!.autoRegisteredSeibans).toEqual({ planningBoards: { A: [], B: ['NEAR', 'FAR'] }, searchHistory: ['NEAR', 'FAR'] });
    expect(mocks.run.autoRegisteredSeibans.planningBoards.A).toEqual(['D1', 'D2']);
    await register([block('D1'), block('D2')]);
    expect(mocks.boards.A.seibanOrder).toEqual([...manual, 'CONCURRENT', 'D1', 'D2']);
    expect(mocks.boards.B.seibanOrder).toEqual([...manual, 'NEAR', 'D1', 'D2']);
    expect(mocks.history).toEqual([...manual, 'NEAR', 'D1', 'D2']);
    expect(mocks.otherRuns[0]!.autoRegisteredSeibans).toEqual({ planningBoards: { A: [], B: ['NEAR'] }, searchHistory: ['NEAR'] });
  });

  it('still warns for D company entries that cannot fit after exhausting internal ownership', async () => {
    const manual = Array.from({ length: 99 }, (_, i) => `M${i}`);
    for (const board of Object.values(mocks.boards)) board.seibanOrder = [...manual, 'INTERNAL'];
    mocks.history = [...manual, 'INTERNAL'];
    mocks.otherRuns = [{ id: 'internal', kind: 'INTERNAL', status: 'SUCCESS', meetingDate: new Date('2026-11-07Z'),
      autoRegisteredSeibans: { planningBoards: { A: ['INTERNAL'], B: ['INTERNAL'] }, searchHistory: ['INTERNAL'] } }];
    await register([block('D1'), block('D2')]);
    expect(mocks.history).toEqual([...manual, 'D1']);
    expect(mocks.run.warnings).toEqual([{ code: 'REGISTRATION_LIMIT', seiban: 'D2', cell: null, rawText: null }]);
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
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'D-ONLY', 'INTERNAL', 'D-NEXT']);
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
    expect(mocks.run.autoRegisteredSeibans.metrics).toMatchObject({ registeredSeibans: ['MAIN'], unregisteredSeibans: [] });
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

  it('retains absent auto entries on planning boards while reconciling shared history', async () => {
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: ['STALE', 'KEEP'], B: ['KEEP'] }, searchHistory: ['STALE', 'KEEP'] } };
    mocks.boards.A.seibanOrder.push('STALE', 'KEEP');
    mocks.boards.B.seibanOrder.push('STALE', 'KEEP'); // STALE was manual at B.
    mocks.history.push('STALE', 'KEEP');
    await register([block('KEEP')]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'STALE', 'KEEP']);
    expect(mocks.run.autoRegisteredSeibans.planningBoards.A).toEqual(['STALE', 'KEEP']);
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
    for (const board of Object.values(mocks.boards)) expect(board.seibanOrder).toContain('SKIPPED');
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
    expect(mocks.boards.NEW.seibanOrder).toEqual(['MANUAL-H', 'STALE', 'MAIN']);
    expect(mocks.run.autoRegisteredSeibans.planningBoards.NEW).toEqual(['STALE', 'MAIN']);
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

  it('uses nearest due first when the limit is reached and warns once per rejected seiban', async () => {
    mocks.boards.A.seibanOrder = Array.from({ length: 99 }, (_, i) => `M${i}`);
    mocks.boards.B.seibanOrder = [...mocks.boards.A.seibanOrder]; mocks.history = [...mocks.boards.A.seibanOrder];
    await register([block('LATE', '2026-11-20'), block('NEAR', '2026-11-05')]);
    expect(mocks.history).toHaveLength(100);
    expect(mocks.history[99]).toBe('NEAR');
    expect(mocks.run.warnings).toEqual([{ code: 'REGISTRATION_LIMIT', seiban: 'LATE', cell: null, rawText: null }]);
  });

  it('re-reads and retries once on each destination conflict, preserving concurrent manual entries', async () => {
    mocks.writeBoard.mockImplementationOnce(() => { mocks.boards.A.seibanOrder.push('CONCURRENT-A'); throw new ApiError(409, 'conflict'); });
    mocks.writeHistory.mockImplementationOnce(() => { mocks.history.push('CONCURRENT-H'); throw new ApiError(409, 'conflict'); });
    await register([block('MAIN')]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'CONCURRENT-A', 'MAIN']);
    expect(mocks.history).toEqual(['MANUAL-H', 'CONCURRENT-H', 'MAIN']);
    expect(mocks.readBoard).toHaveBeenCalledTimes(3);
    expect(mocks.readHistory).toHaveBeenCalledTimes(2);
  });

  it('propagates a second conflict without declaring success', async () => {
    mocks.writeBoard.mockRejectedValue(new ApiError(409, 'conflict'));
    await expect(register([block('MAIN')])).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.writeBoard).toHaveBeenCalledTimes(2);
    expect(mocks.run.status).toBe('APPLIED');
  });
});
