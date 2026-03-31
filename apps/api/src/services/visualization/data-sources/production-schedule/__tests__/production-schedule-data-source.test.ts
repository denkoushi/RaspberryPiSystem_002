import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ProductionScheduleDataSource } from '../production-schedule-data-source.js';
import { prisma } from '../../../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../../production-schedule/constants.js';

vi.mock('../../../../../lib/prisma.js', () => ({
  prisma: {
    kioskProductionScheduleSearchState: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

describe('ProductionScheduleDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should limit history to registered seiban max items', async () => {
    const dataSource = new ProductionScheduleDataSource();

    const overLimit = KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX + 1;
    const historyOver = Array.from({ length: overLimit }, (_, i) => `FSEIBAN${String(i + 1).padStart(3, '0')}`);

    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique).mockResolvedValue({
      state: { history: historyOver },
      updatedAt: new Date(),
    } as any);

    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const result = await dataSource.fetchData();

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows.length).toBeLessThanOrEqual(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX);
    }
  });

  it('should handle empty history', async () => {
    const dataSource = new ProductionScheduleDataSource();

    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique).mockResolvedValue({
      state: { history: [] },
      updatedAt: new Date(),
    } as any);

    const result = await dataSource.fetchData();

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows.length).toBe(0);
      expect(result.metadata?.reason).toBe('history_empty');
    }
  });

  it('should handle exactly max registered seiban items', async () => {
    const dataSource = new ProductionScheduleDataSource();

    const historyMax = Array.from({ length: KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX }, (_, i) =>
      `FSEIBAN${String(i + 1).padStart(3, '0')}`
    );

    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique).mockResolvedValue({
      state: { history: historyMax },
      updatedAt: new Date(),
    } as any);

    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      historyMax.map((fseiban) => ({
        fseiban,
        total: 5,
        completed: 3,
        incompleteProductNames: ['部品A'],
      }))
    );

    const result = await dataSource.fetchData();

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows.length).toBe(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX);
    }
  });
});
