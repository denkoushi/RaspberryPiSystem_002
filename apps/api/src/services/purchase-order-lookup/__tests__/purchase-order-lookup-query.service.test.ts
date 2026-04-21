import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findEarliestPlannedStartDatesBySeibanAndMatchKey: vi.fn(),
  findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd: vi.fn(),
  findMasterFhinmeisByMatchKey: vi.fn(),
  findMasterFhinmeisByNormalizedFhinCd: vi.fn(),
  resolveMachineNamesForPurchaseLookup: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    purchaseOrderLookupRow: { findMany: mocks.findMany },
  },
}));

vi.mock('../purchase-order-lookup-master-part.service.js', () => ({
  findMasterFhinmeisByMatchKey: mocks.findMasterFhinmeisByMatchKey,
  findMasterFhinmeisByNormalizedFhinCd: mocks.findMasterFhinmeisByNormalizedFhinCd,
}));

vi.mock('../purchase-order-lookup-machine-name.service.js', () => ({
  resolveMachineNamesForPurchaseLookup: mocks.resolveMachineNamesForPurchaseLookup,
}));

vi.mock('../purchase-order-lookup-planned-start.service.js', () => ({
  findEarliestPlannedStartDatesBySeibanAndMatchKey: mocks.findEarliestPlannedStartDatesBySeibanAndMatchKey,
  findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd:
    mocks.findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd,
  purchaseOrderLookupSeibanMatchKey: (seiban: string, n: string) => `${seiban.trim()}\t${n.trim()}`,
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
        purchasePartCodeMatchKey: 'MATCH',
        acceptedQuantity: 2,
      },
    ]);
    mocks.findMasterFhinmeisByMatchKey.mockResolvedValue({ MATCH: 'マスタ品名' });
    mocks.findMasterFhinmeisByNormalizedFhinCd.mockResolvedValue({ NORM: '旧マスタ品名' });
    mocks.resolveMachineNamesForPurchaseLookup.mockResolvedValue({ BA1: '機種A' });
    mocks.findEarliestPlannedStartDatesBySeibanAndMatchKey.mockResolvedValue({
      'BA1\tMATCH': new Date(Date.UTC(2026, 4, 3)),
    });
    mocks.findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd.mockResolvedValue({
      'BA1\tNORM': new Date(Date.UTC(2026, 4, 2)),
    });
  });

  it('includes plannedStartDate as YYYY-MM-DD when supplement resolves', async () => {
    const res = await queryPurchaseOrderLookup('0000000001');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].plannedStartDate).toBe('2026-05-03');
    expect(res.rows[0].machineName).toBe('機種A');
    expect(mocks.findEarliestPlannedStartDatesBySeibanAndMatchKey).toHaveBeenCalledWith([
      { seiban: 'BA1', purchasePartCodeMatchKey: 'MATCH' },
    ]);
  });

  it('falls back to normalized lookup when match-key lookup misses', async () => {
    mocks.findMasterFhinmeisByMatchKey.mockResolvedValue({ MATCH: null });
    mocks.findEarliestPlannedStartDatesBySeibanAndMatchKey.mockResolvedValue({});

    const res = await queryPurchaseOrderLookup('0000000001');

    expect(res.rows[0].masterPartName).toBe('旧マスタ品名');
    expect(res.rows[0].plannedStartDate).toBe('2026-05-02');
    expect(mocks.findMasterFhinmeisByNormalizedFhinCd).toHaveBeenCalledWith(['NORM']);
    expect(mocks.findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd).toHaveBeenCalledWith([
      { seiban: 'BA1', purchasePartCodeNormalized: 'NORM' },
    ]);
  });
});
