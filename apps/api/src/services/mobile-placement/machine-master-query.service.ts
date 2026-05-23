import { prisma } from '../../lib/prisma.js';

export type MachineMasterEntry = {
  resourceCd: string;
  resourceName: string;
};

export async function listMachineMastersForShelfLayout(): Promise<{ machines: MachineMasterEntry[] }> {
  const rows = await prisma.productionScheduleResourceMaster.findMany({
    select: { resourceCd: true, resourceName: true },
    orderBy: [{ resourceName: 'asc' }, { resourceCd: 'asc' }]
  });
  return {
    machines: rows.map((r) => ({
      resourceCd: r.resourceCd,
      resourceName: r.resourceName
    }))
  };
}
