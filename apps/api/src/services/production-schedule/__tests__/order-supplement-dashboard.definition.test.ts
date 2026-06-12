import { describe, expect, it, vi } from 'vitest';

import { PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import {
  buildProductionScheduleOrderSupplementDashboardDefinition,
  ensureProductionScheduleOrderSupplementDashboard,
} from '../order-supplement-dashboard.definition.js';

type ColumnDefinition = {
  internalName: string;
  csvHeaderCandidates: string[];
};

describe('order-supplement-dashboard.definition', () => {
  it('生産システム列名を補助納期の列候補に含める', () => {
    const definition = buildProductionScheduleOrderSupplementDashboardDefinition();
    const columns = definition.columnDefinitions as ColumnDefinition[];
    const findColumn = (internalName: string): ColumnDefinition => {
      const column = columns.find((candidate) => candidate.internalName === internalName);
      if (!column) {
        throw new Error(`missing column: ${internalName}`);
      }
      return column;
    };

    expect(findColumn('ProductNo').csvHeaderCandidates).toContain('FSEZONO');
    expect(findColumn('FSIGENCD').csvHeaderCandidates).toContain('FKOTEICD');
    expect(findColumn('plannedQuantity').csvHeaderCandidates).toContain('FKOJUNSIJISU');
    expect(findColumn('plannedStartDate').csvHeaderCandidates).toContain('FKOJUNSTTYOTEIYMD');
    expect(findColumn('plannedEndDate').csvHeaderCandidates).toContain('FKOJUNENDYOTEIYMD');
  });

  it('固定IDでダッシュボード定義を更新する', async () => {
    const prismaClient = {
      csvDashboard: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    await ensureProductionScheduleOrderSupplementDashboard(prismaClient);

    expect(prismaClient.csvDashboard.upsert).toHaveBeenCalledWith({
      where: { id: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID },
      update: expect.objectContaining({
        name: 'ProductionSchedule_OrderSupplement',
      }),
      create: expect.objectContaining({
        id: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
        name: 'ProductionSchedule_OrderSupplement',
      }),
    });
  });
});
