import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  findMasterFhinmeisByMatchKey: vi.fn(),
  findMasterFhinmeisByNormalizedFhinCd: vi.fn(),
  resolveMachineNamesForPurchaseLookup: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    purchaseOrderLookupRow: { findMany: mocks.findMany },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../purchase-order-lookup-master-part.service.js', () => ({
  findMasterFhinmeisByMatchKey: mocks.findMasterFhinmeisByMatchKey,
  findMasterFhinmeisByNormalizedFhinCd: mocks.findMasterFhinmeisByNormalizedFhinCd,
}));

vi.mock('../purchase-order-lookup-machine-name.service.js', () => ({
  resolveMachineNamesForPurchaseLookup: mocks.resolveMachineNamesForPurchaseLookup,
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
    mocks.queryRaw.mockResolvedValue([
      { seiban: 'BA1', fhincd: 'MATCH-001', fhinmei: '品', productNo: '1', completed: false, plannedStartDate: new Date('2026-05-03') },
      { seiban: 'BA1', fhincd: 'NORM(A)', fhinmei: '品', productNo: '1', completed: false, plannedStartDate: new Date('2026-05-02') },
    ]);
  });

  it('includes plannedStartDate as YYYY-MM-DD when supplement resolves', async () => {
    const res = await queryPurchaseOrderLookup('0000000001');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].plannedStartDate).toBe('2026-05-03');
    expect(res.rows[0].machineName).toBe('機種A');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to normalized lookup when match-key lookup misses', async () => {
    mocks.findMasterFhinmeisByMatchKey.mockResolvedValue({ MATCH: null });
    mocks.queryRaw.mockResolvedValue([
      { seiban: 'BA1', fhincd: 'NORM(A)', fhinmei: '品', productNo: '1', completed: false, plannedStartDate: new Date('2026-05-02') },
    ]);

    const res = await queryPurchaseOrderLookup('0000000001');

    expect(res.rows[0].masterPartName).toBe('旧マスタ品名');
    expect(res.rows[0].plannedStartDate).toBe('2026-05-02');
    expect(mocks.findMasterFhinmeisByNormalizedFhinCd).toHaveBeenCalledWith(['NORM']);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });


  it('returns a date for purchase order 0005526578 with a material code and finished-part name', async () => {
    mocks.findMany.mockResolvedValue([{
      seiban: 'BA1', purchasePartName: 'シャフト', purchasePartCodeRaw: 'MD100492280',
      purchasePartCodeNormalized: 'MD100492280', purchasePartCodeMatchKey: 'MD100492280', acceptedQuantity: 1,
    }]);
    mocks.queryRaw.mockResolvedValue([
      { seiban: 'BA1', fhincd: 'FINISHED', fhinmei: 'ｼｬﾌﾄ ', productNo: '1', completed: false, plannedStartDate: new Date('2026-05-02') },
    ]);
    const res = await queryPurchaseOrderLookup('0005526578');
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { purchaseOrderNo: '0005526578' }, orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }],
    });
    expect(res.rows[0].plannedStartDate).toBe('2026-05-02');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when no planned start date matches', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    expect((await queryPurchaseOrderLookup('0000000001')).rows[0].plannedStartDate).toBeNull();
  });
});
