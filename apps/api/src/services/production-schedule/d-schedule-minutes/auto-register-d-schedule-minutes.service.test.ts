import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { applyDScheduleMinutes } from './apply-d-schedule-minutes.service.js';
import { autoRegisterDScheduleMinutes } from './auto-register-d-schedule-minutes.service.js';
import type { DScheduleMinutesMetrics } from './import-summary.js';
import type { DScheduleMinutesBlock } from './parse-d-schedule-minutes.js';

const mocks = vi.hoisted(() => ({
  run: { id: 'current', status: 'APPLIED', warnings: [] as unknown[], autoRegisteredSeibans: { planningBoards: {} as Record<string, string[]>, searchHistory: [] as string[], metrics: undefined as DScheduleMinutesMetrics | undefined } },
  newer: false,
  previous: null as null | { autoRegisteredSeibans: { planningBoards: Record<string, string[]>; searchHistory: string[] } },
  boards: {} as Record<string, { id: string; seibanOrder: string[]; version: number }>,
  history: [] as string[],
  historyVersion: 1, sites: ['A', 'B'],
  readWinners: vi.fn(), rawRows: [] as { rowData: { FSEIBAN: string } }[],
  writeBoard: vi.fn(), writeHistory: vi.fn(), readBoard: vi.fn(), readHistory: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $transaction: (fn: (tx: unknown) => unknown) => fn({
    $executeRaw: vi.fn(),
    csvDashboardRow: { findFirst: ({ where }: { where: { rowData: { equals: string } } }) =>
      mocks.rawRows.find((row) => row.rowData.FSEIBAN === where.rowData.equals) },
    productionScheduleDScheduleMinutesImportRun: {
      findUnique: () => null, create: () => mocks.run,
      update: ({ data }: { data: object }) => Object.assign(mocks.run, data)
    },
    productionScheduleDScheduleMinutes: { findUnique: () => null, upsert: vi.fn() },
    productionScheduleSeibanDueDate: { findUnique: () => null }
  }),
  productionScheduleDScheduleMinutesImportRun: {
    findUniqueOrThrow: () => mocks.run,
    findFirst: ({ where }: { where: { meetingDate?: unknown } }) => where.meetingDate ? (mocks.newer ? { id: 'newer' } : null) : mocks.previous,
    update: ({ data }: { data: object }) => Object.assign(mocks.run, data)
  },
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
const block = (seiban: string, partsCompleteDate = '2026-11-10', aliases: string[] = []): DScheduleMinutesBlock => ({
  seiban, aliasSeibans: aliases, partsCompleteDate, outsourceMarks: [], surfaceSendOutDates: [], memo: null, sourceRow: 8, rawPartsCompleteText: null
});
const register = (blocks: DScheduleMinutesBlock[]) => autoRegisterDScheduleMinutes({ runId: 'current', blocks });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run = { id: 'current', status: 'APPLIED', warnings: [], autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics: undefined } };
  mocks.newer = false; mocks.previous = null; mocks.rawRows = []; mocks.readWinners.mockResolvedValue([]);
  mocks.boards = { A: { id: 'A', seibanOrder: ['MANUAL-A'], version: 1 }, B: { id: 'B', seibanOrder: ['MANUAL-B'], version: 1 } };
  mocks.history = ['MANUAL-H']; mocks.historyVersion = 1; mocks.sites = ['A', 'B'];
  mocks.readBoard.mockImplementation((key: string) => mocks.boards[key]);
  mocks.readHistory.mockImplementation(() => ({ state: { history: mocks.history }, etag: String(mocks.historyVersion) }));
  mocks.writeBoard.mockImplementation(({ siteKey, fseibans }: { siteKey: string; fseibans: string[] }) => {
    mocks.boards[siteKey].seibanOrder = fseibans; mocks.boards[siteKey].version++;
  });
  mocks.writeHistory.mockImplementation(({ incomingHistory }: { incomingHistory: string[] }) => { mocks.history = incomingHistory; mocks.historyVersion++; });
});

describe('D schedule automatic registration', () => {
  it('applies a non-winner warning and finishes registration on every site and shared history', async () => {
    mocks.rawRows = ['SUPERSEDED', 'MAIN', 'ALIAS'].map((FSEIBAN) => ({ rowData: { FSEIBAN } }));
    mocks.readWinners.mockResolvedValue(mocks.rawRows.slice(1));
    const writeBoard = mocks.writeBoard.getMockImplementation()!;
    mocks.writeBoard.mockImplementation((input: { siteKey: string; fseibans: string[] }) => {
      if (input.fseibans.includes('SUPERSEDED')) throw new ApiError(400, 'UNKNOWN_SEIBAN');
      return writeBoard(input);
    });
    const run = await applyDScheduleMinutes({
      result: { ok: true, meetingDate: '2026-10-30', blocks: [block('SUPERSEDED'), block('MAIN', undefined, ['ALIAS'])], warnings: [] },
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

  it('removes stale auto entries while preserving manual registrations independently per destination', async () => {
    mocks.previous = { autoRegisteredSeibans: { planningBoards: { A: ['STALE', 'KEEP'], B: ['KEEP'] }, searchHistory: ['STALE', 'KEEP'] } };
    mocks.boards.A.seibanOrder.push('STALE', 'KEEP');
    mocks.boards.B.seibanOrder.push('STALE', 'KEEP'); // STALE was manual at B.
    mocks.history.push('STALE', 'KEEP');
    await register([block('KEEP')]);
    expect(mocks.boards.A.seibanOrder).toEqual(['MANUAL-A', 'KEEP']);
    expect(mocks.boards.B.seibanOrder).toEqual(['MANUAL-B', 'STALE', 'KEEP']);
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
