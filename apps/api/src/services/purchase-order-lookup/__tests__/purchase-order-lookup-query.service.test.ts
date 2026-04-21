import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd: vi.fn(),
  findMasterFhinmeisByNormalizedFhinCd: vi.fn(),
  resolveMachineNamesForPurchaseLookup: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    purchaseOrderLookupRow: { findMany: mocks.findMany },
  },
}));

vi.mock('../purchase-order-lookup-master-part.service.js', () => ({
  findMasterFhinmeisByNormalizedFhinCd: mocks.findMasterFhinmeisByNormalizedFhinCd,
}));

vi.mock('../purchase-order-lookup-machine-name.service.js', () => ({
  resolveMachineNamesForPurchaseLookup: mocks.resolveMachineNamesForPurchaseLookup,
}));

vi.mock('../purchase-order-lookup-planned-start.service.js', () => ({
  findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd: mocks.findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd,
  purchaseOrderLookupSeibanNormKey: (seiban: string, n: string) => `${seiban.trim()}\t${n.trim()}`,
}));

import { queryPurchaseOrderLookup } from '../purchase-order-lookup-query.service.js';

describe('queryPurchaseOrderLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      {
        seiban: 'BA1',
        purchasePartName: '品',
        purchasePartCodeRaw: 'RAW',
        purchasePartCodeNormalized: 'NORM',
        acceptedQuantity: 2,
      },
    ]);
    mocks.findMasterFhinmeisByNormalizedFhinCd.mockResolvedValue({ NORM: 'マスタ品名' });
    mocks.resolveMachineNamesForPurchaseLookup.mockResolvedValue({ BA1: '機種A' });
    mocks.findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd.mockResolvedValue({
      'BA1\tNORM': new Date(Date.UTC(2026, 4, 3)),
    });
  });

  it('includes plannedStartDate as YYYY-MM-DD when supplement resolves', async () => {
    const res = await queryPurchaseOrderLookup('0000000001');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].plannedStartDate).toBe('2026-05-03');
    expect(res.rows[0].machineName).toBe('機種A');
    expect(mocks.findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd).toHaveBeenCalledWith([
      { seiban: 'BA1', purchasePartCodeNormalized: 'NORM' },
    ]);
  });
});
