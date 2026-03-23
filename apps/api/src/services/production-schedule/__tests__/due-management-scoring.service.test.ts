import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { loadActualHoursSignals } from '../due-management-scoring.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleActualHoursFeature: {
      findMany: vi.fn(),
    },
    productionScheduleResourceCodeMapping: {
      findMany: vi.fn(),
    },
    productionScheduleResourceMaster: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

describe('due-management-scoring.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GroupCD を通じて coverage を算出できる', async () => {
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'kiosk-1',
        fhincd: 'X',
        resourceCd: 'R03',
        sampleCount: 8,
        medianPerPieceMinutes: 5,
        p75PerPieceMinutes: 7,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleResourceCodeMapping.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany)
      .mockResolvedValueOnce([{ resourceCd: 'R01', groupCd: 'CUT-A' }] as never)
      .mockResolvedValueOnce([
        { resourceCd: 'R01', groupCd: 'CUT-A' },
        { resourceCd: 'R03', groupCd: 'CUT-A' },
      ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'A', fhincd: 'X', resourceCd: 'R01' },
      { fseiban: 'A', fhincd: 'X', resourceCd: 'R01' },
    ] as never);

    const result = await loadActualHoursSignals({
      locationScope: { deviceScopeKey: 'kiosk-1', siteKey: 'site-1' },
      candidateFseibans: ['A'],
    });

    const signal = result.get('A');
    expect(signal).toBeDefined();
    expect(signal?.coverageRatio).toBe(1);
    expect(signal?.actualHoursScore).toBeGreaterThan(0.5);
  });
});
