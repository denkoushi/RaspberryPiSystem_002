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
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([] as never);
    expect(await listMachinesForShelfRegistration()).toEqual({ machines: ['003', '004', '50013_540AP', 'DAD-3220'] });
    expect(listProductionScheduleResources).toHaveBeenCalledExactlyOnceWith({});
  });

  it('excludes Sendai resources whose group code starts with S-', async () => {
    vi.mocked(listProductionScheduleResources).mockResolvedValue({
      resources: ['021', 'a5m', 'CSG'],
      resourceItems: [],
      resourceNameMap: { '021': ['三島機'], A5M: ['仙台機A'], CSG: ['仙台機C'] }
    });
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([{ resourceCd: 'A5M' }, { resourceCd: 'CSG ' }] as never);
    expect(await listMachinesForShelfRegistration()).toEqual({ machines: ['三島機'] });
    expect(prisma.productionScheduleResourceMaster.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { resourceGroupCd: { startsWith: 'S-' } },
      select: { resourceCd: true }
    });
  });

  it('keeps the existing layout master list unchanged', async () => {
    const machines = [{ resourceCd: '999', resourceName: 'Outside' }, { resourceCd: '998', resourceName: 'Outside' }];
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue(machines as never);
    expect(await listMachineMastersForShelfLayout()).toEqual({ machines });
    expect(listProductionScheduleResources).not.toHaveBeenCalled();
  });
});
