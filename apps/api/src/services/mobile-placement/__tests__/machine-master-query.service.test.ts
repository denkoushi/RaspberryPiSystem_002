import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { listProductionScheduleResources } from '../../production-schedule/production-schedule-query/resources.js';
import { listMachineMastersForShelfLayout, listMachinesForShelfRegistration } from '../machine-master-query.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleResourceMaster: { findMany: vi.fn() } } }));
vi.mock('../../production-schedule/production-schedule-query/resources.js', () => ({ listProductionScheduleResources: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('shelf registration machines', () => {
  it('uses schedule codes, dedupes names, keeps excluded resources and falls back to code', async () => {
    vi.mocked(listProductionScheduleResources).mockResolvedValue({
      resources: ['001', '002', '003', '004'],
      resourceItems: [{ resourceCd: '002', excluded: true }],
      resourceNameMap: { '001': ['DAD-3220', '50013_540AP'], '002': ['DAD-3220'], '004': [' '], '999': ['Outside'] }
    });
    expect(await listMachinesForShelfRegistration()).toEqual({ machines: ['003', '004', '50013_540AP', 'DAD-3220'] });
    expect(listProductionScheduleResources).toHaveBeenCalledExactlyOnceWith({});
    expect(prisma.productionScheduleResourceMaster.findMany).not.toHaveBeenCalled();
  });

  it('keeps the existing layout master list unchanged', async () => {
    const machines = [{ resourceCd: '999', resourceName: 'Outside' }, { resourceCd: '998', resourceName: 'Outside' }];
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue(machines as never);
    expect(await listMachineMastersForShelfLayout()).toEqual({ machines });
    expect(listProductionScheduleResources).not.toHaveBeenCalled();
  });
});
