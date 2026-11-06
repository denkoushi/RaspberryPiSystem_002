import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { id: 'board', version: 0, seibanOrder: ['A', 'B', 'C', 'D', 'E', 'F'], uncheckedFseibans: null as string[] | null },
  rows: [] as { id: string; rowData: Record<string, string> }[],
  details: new Map(),
  update: vi.fn(), transaction: vi.fn(), readWinners: vi.fn(),
  minutes: vi.fn().mockResolvedValue([])
}));
vi.mock('../../../lib/prisma.js', () => {
  const client = {
    $queryRaw: vi.fn(async () => [structuredClone(mocks.state)]),
    productionScheduleGrindingPlanningBoardState: {
      findUnique: vi.fn(async () => structuredClone(mocks.state)),
      findMany: vi.fn(async () => [{ siteKey: 'site' }]), update: mocks.update
    },
    productionScheduleDScheduleMinutes: { findMany: mocks.minutes }
  };
  return { prisma: { ...client, $transaction: (...args: unknown[]) => mocks.transaction(...args, client) } };
});
vi.mock('../grinding-planning-board/source.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../grinding-planning-board/source.js')>(),
  readWinnerRowsByFseibans: mocks.readWinners,
  readRowDetails: vi.fn(async () => mocks.details)
}));
vi.mock('../sessaku-pieces/piece-key.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../sessaku-pieces/piece-key.js')>(),
  readSessakuPieceSets: vi.fn(async () => new Map())
}));
vi.mock('../policies/resource-category-policy.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../policies/resource-category-policy.service.js')>(),
  getResourceCategoryPolicy: vi.fn(async () => ({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: ['999'] }))
}));

import { prisma } from '../../../lib/prisma.js';
import { pruneCompletedGrindingPlanningBoardSeibans } from '../grinding-planning-board/completion.js';
import { boardRevision } from '../grinding-planning-board/state.js';
import { updateGrindingPlanningBoardSeibanChecks, updateGrindingPlanningBoardSeibanOrder } from '../grinding-planning-board/write.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { id: 'board', version: 0, seibanOrder: ['A', 'B', 'C', 'D', 'E', 'F'], uncheckedFseibans: null };
  mocks.rows = []; mocks.details = new Map();
  mocks.minutes.mockResolvedValue([]);
  mocks.readWinners.mockImplementation(async () => mocks.rows);
  mocks.transaction.mockImplementation(async (fn, _options, client) => fn(client));
  mocks.update.mockImplementation(async ({ data }) => {
    mocks.state = { ...mocks.state, ...data, version: mocks.state.version + 1 };
    return structuredClone(mocks.state);
  });
});

describe('board check persistence', () => {
  it('saves a normalized board-scoped set, prunes absent seibans and keeps order unchanged', async () => {
    const order = [...mocks.state.seibanOrder];
    const revision = boardRevision(mocks.state);
    const result = await updateGrindingPlanningBoardSeibanChecks({ siteKey: 'site', sourceRevision: revision, uncheckedFseibans: [' B ', 'B', 'absent'] });
    expect(result.uncheckedFseibans).toEqual(['B']);
    expect(mocks.state.seibanOrder).toEqual(order);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ uncheckedFseibans: ['B'], version: { increment: 1 } });
    expect(result.sourceRevision).not.toBe(revision);
    await expect(updateGrindingPlanningBoardSeibanChecks({ siteKey: 'site', sourceRevision: revision, uncheckedFseibans: [] })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('materializes the first explicit empty save and is idempotent thereafter', async () => {
    for (let i = 0; i < 2; i++) await updateGrindingPlanningBoardSeibanChecks({ siteKey: 'site', sourceRevision: boardRevision(mocks.state), uncheckedFseibans: [] });
    expect(mocks.state.uncheckedFseibans).toEqual([]);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('converts a serializable transaction conflict to 409', async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '7' }));
    await expect(updateGrindingPlanningBoardSeibanChecks({ siteKey: 'site', sourceRevision: boardRevision(mocks.state), uncheckedFseibans: [] })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('manual addition is checked even on legacy boards and removal prunes checks', async () => {
    mocks.minutes.mockResolvedValue([{ fseiban: 'A', assigneesKnown: true, assignees: ['組立課'] }, { fseiban: 'NEW', assigneesKnown: true, assignees: ['組立課'] }]);
    mocks.rows = [{ id: 'new', rowData: { FSEIBAN: 'NEW' } }];
    await updateGrindingPlanningBoardSeibanOrder({ siteKey: 'site', sourceRevision: boardRevision(mocks.state), fseibans: ['NEW', 'A'] });
    expect(mocks.state.uncheckedFseibans).toEqual(['A']);
    await updateGrindingPlanningBoardSeibanOrder({ siteKey: 'site', sourceRevision: boardRevision(mocks.state), fseibans: ['NEW'] });
    expect(mocks.state.uncheckedFseibans).toEqual([]);
  });
  it('import defaults apply only to newly added seibans atomically with order', async () => {
    mocks.state.uncheckedFseibans = ['B'];
    mocks.rows = [{ id: 'new', rowData: { FSEIBAN: 'NEW' } }];
    await updateGrindingPlanningBoardSeibanOrder({ siteKey: 'site', sourceRevision: boardRevision(mocks.state),
      fseibans: ['A', 'B', 'NEW'], newUncheckedFseibans: ['A', 'NEW'] });
    expect(mocks.state.uncheckedFseibans).toEqual(['B', 'NEW']);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});

function process(id: string, seiban: string, resource: string, manual: boolean, external = false, part = 'PART') {
  mocks.rows.push({ id, rowData: { FSEIBAN: seiban, FSIGENCD: resource, FHINCD: part, ProductNo: '1', FKOJUN: id, FSIGENSHOYORYO: '5' } });
  mocks.details.set(id, { rowNotes: [], orderSupplements: [], productionScheduleProgress: { isCompleted: manual }, productionScheduleExternalCompletion: { isExternallyCompleted: external } });
}

describe('post-ingest completion pruning', () => {
  it('removes only fully complete cutting/grinding parts and prunes their unchecked entries', async () => {
    mocks.state.uncheckedFseibans = ['A', 'B', 'C'];
    process('1', 'A', '305', true); process('2', 'A', '581', false, true);
    process('3', 'B', '305', true); process('4', 'B', '581', false);
    process('5', 'C', '999', true); // excluded resource only
    process('6', 'D', '', true); // no category items
    process('7', 'E', '305', true, false, 'MH-machine');
    // F has no rows at all.
    await pruneCompletedGrindingPlanningBoardSeibans();
    expect(mocks.state.seibanOrder).toEqual(['B', 'C', 'D', 'E', 'F']);
    expect(mocks.state.uncheckedFseibans).toEqual(['B', 'C']);
    expect(mocks.state.version).toBe(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });
  it('keeps a seiban with another unfinished part or missing completion detail', async () => {
    process('1', 'A', '305', true); process('2', 'A', '305', false, false, 'OTHER');
    process('3', 'B', '305', true); process('4', 'B', '581', true);
    mocks.details.delete('4');
    await pruneCompletedGrindingPlanningBoardSeibans();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('retries serialization once using the current locked state and fresh completion data', async () => {
    process('1', 'A', '305', true);
    mocks.transaction.mockImplementationOnce(async () => {
      mocks.state.seibanOrder = ['CONCURRENT', ...mocks.state.seibanOrder];
      mocks.state.uncheckedFseibans = ['CONCURRENT']; mocks.state.version++;
      throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '7' });
    });
    await pruneCompletedGrindingPlanningBoardSeibans();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.state.seibanOrder).toEqual(['CONCURRENT', 'B', 'C', 'D', 'E', 'F']);
    expect(mocks.state.uncheckedFseibans).toEqual(['CONCURRENT']);
    expect(mocks.readWinners).toHaveBeenCalledWith(expect.anything(), ['CONCURRENT', 'A', 'B', 'C', 'D', 'E', 'F']);
  });
  it('retains database null on boards with nothing to remove', async () => {
    await pruneCompletedGrindingPlanningBoardSeibans();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.state.uncheckedFseibans).toBeNull();
    expect(prisma.productionScheduleGrindingPlanningBoardState.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { siteKey: true } }));
  });
});
