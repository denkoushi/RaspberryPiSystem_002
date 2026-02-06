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

  it('should limit history to 20 items', async () => {
    const dataSource = new ProductionScheduleDataSource();

    // 25件の登録製番を用意（上限20件を超える）
    const history25 = Array.from({ length: 25 }, (_, i) => `FSEIBAN${String(i + 1).padStart(3, '0')}`);

    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique).mockResolvedValue({
      state: { history: history25 },
      updatedAt: new Date(),
    } as any);

    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const result = await dataSource.fetchData();

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      // 20件に制限されていることを確認
      expect(result.rows.length).toBeLessThanOrEqual(20);
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

  it('should handle exactly 20 items', async () => {
    const dataSource = new ProductionScheduleDataSource();

    const history20 = Array.from({ length: 20 }, (_, i) => `FSEIBAN${String(i + 1).padStart(3, '0')}`);

    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique).mockResolvedValue({
      state: { history: history20 },
      updatedAt: new Date(),
    } as any);

    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      history20.map((fseiban) => ({
        fseiban,
        total: 5,
        completed: 3,
        incompleteProductNames: ['部品A'],
      }))
    );

    const result = await dataSource.fetchData();

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows.length).toBe(20);
    }
  });
});
