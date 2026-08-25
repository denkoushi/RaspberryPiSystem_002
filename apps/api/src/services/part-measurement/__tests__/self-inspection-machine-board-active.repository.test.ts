import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    selfInspectionSession: { findMany },
  },
}));

import {
  fetchSelfInspectionMachineBoardActiveSessions,
  SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT,
} from '../self-inspection-machine-board-active.repository.js';

function row(index: number) {
  return {
    id: `session-${index}`,
    sessionBusinessKey: `P-${index}::CUTTING::R1::row-${index}`,
    productNo: `P-${index}`,
    processGroup: 'CUTTING' as const,
    resourceCd: 'R1',
    scheduleRowId: `row-${index}`,
    fseiban: `S-${index}`,
    fhincd: `H-${index}`,
    fhinmei: `品名-${index}`,
    machineName: null,
    plannedQuantity: 1,
    expectedEntryCount: 1,
    completedAt: null,
    updatedAt: new Date(2026, 7, 25, 0, 0, index),
    template: {
      selfInspectionMode: 'SINGLE' as const,
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
    },
    entries: [
      {
        entryIndex: 0,
        persistenceStatus: 'DRAFT' as const,
        values: [],
      },
    ],
  };
}

describe('self-inspection-machine-board-active.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries non-invalidated active sessions with DRAFT-presence and returns 200+hasMore', async () => {
    findMany.mockResolvedValue(
      Array.from({ length: SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT + 1 }, (_, i) =>
        row(i)
      )
    );

    const result = await fetchSelfInspectionMachineBoardActiveSessions();

    expect(result.sessions).toHaveLength(SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT);
    expect(result.limit).toBe(SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT);
    expect(result.hasMore).toBe(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invalidatedAt: null,
          completedAt: null,
          entries: { some: {} },
        }),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT + 1,
      })
    );
  });

  it('caps caller limit at 200 and returns false when the DB result fits', async () => {
    findMany.mockResolvedValue([row(1)]);

    const result = await fetchSelfInspectionMachineBoardActiveSessions({ limit: 999 });

    expect(result.limit).toBe(SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT);
    expect(result.hasMore).toBe(false);
    expect(result.sessions).toHaveLength(1);
  });
});
