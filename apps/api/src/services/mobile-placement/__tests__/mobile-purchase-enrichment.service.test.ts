import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { listKnownScheduleFseibans } from '../../production-schedule/production-schedule-lookup.service.js';
import { resolveMachineNamesForPurchaseLookup } from '../../purchase-order-lookup/purchase-order-lookup-machine-name.service.js';
import { findMasterFhinmeisByMatchKey, findMasterFhinmeisByNormalizedFhinCd } from '../../purchase-order-lookup/purchase-order-lookup-master-part.service.js';
import { listPurchasePlannedStartCandidates } from '../../purchase-order-lookup/purchase-order-lookup-planned-start.service.js';
import { buildMobilePurchaseEnrichment } from '../mobile-purchase-enrichment.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleSeibanMachineNameSupplement: { findMany: vi.fn() } } }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listKnownScheduleFseibans: vi.fn() }));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-machine-name.service.js', () => ({ resolveMachineNamesForPurchaseLookup: vi.fn() }));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-master-part.service.js', () => ({
  findMasterFhinmeisByMatchKey: vi.fn(),
  findMasterFhinmeisByNormalizedFhinCd: vi.fn(),
}));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-planned-start.service.js', () => ({ listPurchasePlannedStartCandidates: vi.fn() }));

describe('buildMobilePurchaseEnrichment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(findMasterFhinmeisByMatchKey).mockResolvedValue({ MD100: 'ボルト', '': 'ignored-empty-key' } as never);
    vi.mocked(findMasterFhinmeisByNormalizedFhinCd).mockResolvedValue({ 'MD100-001': 'ボルト枝', NULLV: null } as never);
    vi.mocked(listKnownScheduleFseibans).mockResolvedValue(['S1'] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([{ fseiban: 'S2' }] as never);
    vi.mocked(resolveMachineNamesForPurchaseLookup).mockResolvedValue({ S1: 'HNC-1', S2: 'MC-2' } as never);
    vi.mocked(listPurchasePlannedStartCandidates).mockResolvedValue([
      { seiban: 'S1', fhincd: 'MD100', fhinmei: 'ボルト', plannedStartDate: new Date('2026-11-04T00:00:00.000Z'), productNo: '0001234567', completed: true },
      { seiban: 'S1', fhincd: 'MD200', fhinmei: 'ナット', plannedStartDate: null, productNo: '0001234568', completed: false },
      { seiban: 'S2', fhincd: 'MD300', fhinmei: 'ピン', plannedStartDate: new Date('2026-12-01T00:00:00.000Z'), productNo: '0001234569', completed: false },
    ] as never);
  });

  it('resolves machine names for schedule fseibans plus supplement fseibans', async () => {
    await buildMobilePurchaseEnrichment();
    expect(resolveMachineNamesForPurchaseLookup).toHaveBeenCalledWith(['S1', 'S2']);
  });

  it('emits match/normalized/machine tuples, dropping empty keys and null values, then dated rows', async () => {
    const { rows } = await buildMobilePurchaseEnrichment();
    expect(rows).toEqual([
      ['match', 'MD100', 'ボルト'],
      ['normalized', 'MD100-001', 'ボルト枝'],
      ['machine', 'S1', 'HNC-1'],
      ['machine', 'S2', 'MC-2'],
      ['date', 'S1', 'MD100', 'ボルト', '2026-11-04', '0001234567', 1],
      ['date', 'S2', 'MD300', 'ピン', '2026-12-01', '0001234569', 0],
    ]);
  });
});
