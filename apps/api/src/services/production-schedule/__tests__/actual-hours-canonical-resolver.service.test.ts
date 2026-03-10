import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { ActualHoursCanonicalResolverService } from '../actual-hours/actual-hours-canonical-resolver.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleActualHoursRaw: {
      findMany: vi.fn(),
    },
    productionScheduleActualHoursCanonical: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('actual-hours-canonical-resolver.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.productionScheduleActualHoursCanonical.createMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
  });

  it('source rows から canonical を作成する', async () => {
    vi.mocked(prisma.productionScheduleActualHoursRaw.findMany).mockResolvedValue([
      {
        id: 'raw-1',
        sourceFileKey: 'file-a',
        sourceMessageId: null,
        sourceScheduleId: 'schedule-1',
        workDate: new Date('2024-12-01T00:00:00.000Z'),
        fseiban: 'SEI001',
        fhincd: 'PART001',
        lotNo: 'LOT1',
        lotQty: 10,
        resourceCd: 'R01',
        processOrder: 10,
        actualMinutes: 120,
        perPieceMinutes: 12,
        isExcluded: false,
        excludeReason: null,
        createdAt: new Date('2024-12-02T00:00:00.000Z'),
        updatedAt: new Date('2024-12-02T00:00:00.000Z'),
      },
    ] as never);
    vi.mocked(prisma.productionScheduleActualHoursCanonical.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productionScheduleActualHoursCanonical.createMany).mockResolvedValue({ count: 1 } as never);

    const service = new ActualHoursCanonicalResolverService();
    const result = await service.rebuildForSource({
      locationKey: 'kiosk-1',
      sourceFileKey: 'file-a',
    });

    expect(result.sourceRows).toBe(1);
    expect(result.candidateKeys).toBe(1);
    expect(result.canonicalCreated).toBe(1);
    expect(prisma.productionScheduleActualHoursCanonical.createMany).toHaveBeenCalledTimes(1);
  });
});
