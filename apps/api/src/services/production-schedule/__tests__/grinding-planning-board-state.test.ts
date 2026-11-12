import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { version: 0, updatedAt: new Date('2026-10-01') },
  prisma: {
    productionScheduleGrindingPlanningBoardState: { findUnique: vi.fn() },
    productionScheduleGrindingPlanningBoardOverride: { aggregate: vi.fn() },
    productionScheduleResourceMaster: { aggregate: vi.fn() },
    productionScheduleSeibanMachineNameSupplement: { aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceMinutesSource: { aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartMinutes: { aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceCapacity: { aggregate: vi.fn() }
  },
  readGrindingPlanningBoardSnapshotGenerationToken: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../leaderboard/leaderboard-shell-snapshot-generation.js', () => ({
  readGrindingPlanningBoardSnapshotGenerationToken: mocks.readGrindingPlanningBoardSnapshotGenerationToken
}));
vi.mock('../sessaku-pieces/piece-key.js', () => ({ readSessakuPieceGeneration: vi.fn() }));
import { readSessakuPieceGeneration } from '../sessaku-pieces/piece-key.js';
import { readPlanningLoadGenerationToken, readPlanningSnapshotGenerationDetails } from '../grinding-planning-board/state.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue(mocks.state);
  for (const table of Object.values(mocks.prisma)) {
    if ('aggregate' in table) table.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  }
  mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('leaderboard-1');
  vi.mocked(readSessakuPieceGeneration).mockResolvedValue('pieces-1');
});

describe('load generation token', () => {
  it.each(['leaderboard', 'piece'])('changes when %s generation changes', async (input) => {
    const before = await readPlanningLoadGenerationToken('site-a');
    if (input === 'leaderboard') mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('changed');
    else vi.mocked(readSessakuPieceGeneration).mockResolvedValue('changed-pieces');
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
  });

  it.each([
    'productionScheduleGrindingPlanningBoardOverride',
    'productionScheduleGrindingPlanningBoardResourceMinutesSource',
    'productionScheduleGrindingPlanningBoardResourcePartMinutes'
  ] as const)('tracks count and timestamp independently for %s', async (table) => {
    const aggregate = mocks.prisma[table].aggregate;
    const baseline = await aggregate();
    const before = await readPlanningLoadGenerationToken('site-a');
    aggregate.mockResolvedValue({ ...baseline, _count: { _all: baseline._count._all + 1 } });
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
    aggregate.mockResolvedValue({ ...baseline, _max: { updatedAt: new Date('2026-11-01') } });
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
    if (table === 'productionScheduleGrindingPlanningBoardOverride') {
      expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
        siteKey: 'site-a', OR: ['row:', 'piece:', 'pieceops:'].map((prefix) => ({ itemKey: { startsWith: prefix } }))
      }) }));
    }
  });

  it.each(['boardVersion', 'boardUpdatedAt', 'resource', 'machineName', 'capacity'])('excludes %s while retaining it in the full token', async (input) => {
    const before = await readPlanningSnapshotGenerationDetails('site-a');
    if (input === 'boardVersion' || input === 'boardUpdatedAt') {
      mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({
        ...mocks.state, ...(input === 'boardVersion' ? { version: 99 } : { updatedAt: new Date('2026-11-01') })
      });
    } else {
      const table = input === 'resource' ? mocks.prisma.productionScheduleResourceMaster
        : input === 'machineName' ? mocks.prisma.productionScheduleSeibanMachineNameSupplement
        : mocks.prisma.productionScheduleGrindingPlanningBoardResourceCapacity;
      table.aggregate.mockResolvedValue({ _count: { _all: 99 }, _max: { updatedAt: new Date('2026-11-01') } });
    }
    const after = await readPlanningSnapshotGenerationDetails('site-a');
    expect(after.loadGenerationToken).toBe(before.loadGenerationToken);
    expect(after.generationToken).not.toBe(before.generationToken);
  });
});

