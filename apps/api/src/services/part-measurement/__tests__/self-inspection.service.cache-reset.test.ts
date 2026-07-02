import { beforeEach, describe, expect, it, vi } from 'vitest';

const resetSelfInspectionMachineBoardScheduleRowCaches = vi.hoisted(() => vi.fn());

vi.mock('../self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches,
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    selfInspectionSession: {
      findUnique: vi.fn(),
    },
    selfInspectionMeasurementValue: {
      findMany: vi.fn(),
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
    const result = {
      id: 'session-1',
      sessionBusinessKey: 'session-key',
      templateId: 'template-1',
      productNo: 'PN-1',
      fseiban: 'FS-1',
      fhincd: 'FH-1',
      fhinmei: '品名',
      processGroup: 'cutting',
      resourceCd: 'RES-1',
      scheduleRowId: 'schedule-1',
      machineName: null,
      plannedQuantity: 10,
      expectedEntryCount: 2,
      completedAt: new Date('2026-06-10T00:00:00.000Z'),
      startedAt: new Date('2026-06-10T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
      _count: { entries: 2 },
      template: {
        name: 'template',
        selfInspectionMode: 'sample',
        selfInspectionFixedCount: null,
        selfInspectionSampleSize: 2,
        items: []
      }
    };
    vi.mocked(prisma.$transaction).mockResolvedValue(result as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.selfInspectionMeasurementValue.findMany).mockResolvedValue([] as never);

    const response = await service.completeSession('session-1');

    expect(response).toMatchObject({ id: 'session-1' });
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
