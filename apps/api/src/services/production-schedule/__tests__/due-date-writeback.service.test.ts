import { beforeEach, describe, expect, it, vi } from 'vitest';

const resetSelfInspectionMachineBoardScheduleRowCaches = vi.hoisted(() => vi.fn());

vi.mock('../../part-measurement/self-inspection-machine-board.repository.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches,
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../../lib/prisma.js';
import { writebackSeibanDueDateToRowNotes } from '../due-date-writeback.service.js';

describe('due-date-writeback.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates self-inspection machine board schedule row cache after seiban due date writeback', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'row-1' }] as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        productionScheduleRowNote: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
      };
      return fn(tx as never);
    });

    await writebackSeibanDueDateToRowNotes({
      locationKey: 'kiosk-1',
      fseiban: 'S001',
      dueDateText: '2026-06-15',
    });

    expect(resetSelfInspectionMachineBoardScheduleRowCaches).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate cache when no rows are affected', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    await writebackSeibanDueDateToRowNotes({
      locationKey: 'kiosk-1',
      fseiban: 'S001',
      dueDateText: '2026-06-15',
    });

    expect(resetSelfInspectionMachineBoardScheduleRowCaches).not.toHaveBeenCalled();
  });
});
