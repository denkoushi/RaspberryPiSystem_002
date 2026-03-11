import { prisma } from '../../lib/prisma.js';

export type ProductionScheduleResourceNameMap = Record<string, string[]>;

const normalizeResourceCd = (value: string): string => value.trim();

export async function getResourceNameMapByResourceCds(resourceCds: string[]): Promise<ProductionScheduleResourceNameMap> {
  const normalizedResourceCds = Array.from(
    new Set(resourceCds.map((resourceCd) => normalizeResourceCd(resourceCd)).filter((resourceCd) => resourceCd.length > 0))
  );
  if (normalizedResourceCds.length === 0) {
    return {};
  }

  const rows = await prisma.productionScheduleResourceMaster.findMany({
    where: {
      resourceCd: {
        in: normalizedResourceCds
      }
    },
    select: {
      resourceCd: true,
      resourceName: true
    },
    orderBy: [{ resourceCd: 'asc' }, { resourceName: 'asc' }]
  });

  const resourceNameMap: ProductionScheduleResourceNameMap = {};
  for (const row of rows) {
    const resourceCd = normalizeResourceCd(row.resourceCd);
    const resourceName = row.resourceName.trim();
    if (!resourceCd || !resourceName) {
      continue;
    }
    const names = resourceNameMap[resourceCd] ?? [];
    if (!names.includes(resourceName)) {
      names.push(resourceName);
    }
    resourceNameMap[resourceCd] = names;
  }

  return resourceNameMap;
}
