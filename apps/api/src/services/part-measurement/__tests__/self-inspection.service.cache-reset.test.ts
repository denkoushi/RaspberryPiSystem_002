import { beforeEach, describe, expect, it, vi } from 'vitest';

const resetSelfInspectionMachineBoardScheduleRowCaches = vi.hoisted(() => vi.fn());

vi.mock('../self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches,
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    selfInspectionSession: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../../../lib/prisma.js';
import { SelfInspectionService } from '../self-inspection.service.js';

describe('self-inspection.service cache reset hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createEntry invalidates machine board caches after success', async () => {
    const service = new SelfInspectionService();
    const result = { id: 'entry-1' };
    vi.mocked(prisma.$transaction).mockResolvedValue(result as never);

    const response = await service.createEntry('session-1', {
      entryIndex: 1,
      values: [],
      createdByEmployeeId: 'emp-1',
      createdByEmployeeNameSnapshot: 'Tester',
    });

    expect(response).toBe(result);
    expect(resetSelfInspectionMachineBoardScheduleRowCaches).toHaveBeenCalledTimes(1);
  });

  it('updateEntry invalidates machine board caches after success', async () => {
    const service = new SelfInspectionService();
    const result = { id: 'entry-1' };
    vi.mocked(prisma.$transaction).mockResolvedValue(result as never);

    const response = await service.updateEntry('session-1', 'entry-1', {
      ifUnmodifiedSince: new Date('2026-06-09T00:00:00.000Z').toISOString(),
      values: [],
      employeeTagUid: null,
    });

    expect(response).toBe(result);
    expect(resetSelfInspectionMachineBoardScheduleRowCaches).toHaveBeenCalledTimes(1);
  });

  it('completeSession invalidates machine board caches after success', async () => {
    const service = new SelfInspectionService();
    const result = { id: 'session-1' };
    vi.mocked(prisma.$transaction).mockResolvedValue(result as never);

    const response = await service.completeSession('session-1');

    expect(response).toBe(result);
    expect(resetSelfInspectionMachineBoardScheduleRowCaches).toHaveBeenCalledTimes(1);
  });

  it('resetSession invalidates machine board caches after success', async () => {
    const service = new SelfInspectionService();
    const result = { id: 'session-2' };
    vi.mocked(prisma.selfInspectionSession.findUnique).mockResolvedValue({ id: 'session-1' } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue(result as never);

    const response = await service.resetSession('session-1', {
      confirmDestructiveReset: true,
      confirmCompletedSessionReset: true,
      requestId: 'req-1',
      authMode: 'bearer',
    });

    expect(response).toBe(result);
    expect(resetSelfInspectionMachineBoardScheduleRowCaches).toHaveBeenCalledTimes(1);
  });
});
