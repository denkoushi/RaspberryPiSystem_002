import { prisma } from '../../lib/prisma.js';

export type ProductionScheduleResourceNameMap = Record<string, string[]>;
export type ProductionScheduleResourceGroupCandidatesMap = Record<string, string[]>;

const normalizeResourceCd = (value: string): string => value.trim().toUpperCase();
const normalizeGroupCd = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

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

export async function getResourceGroupCandidatesByResourceCds(
  resourceCds: string[]
): Promise<ProductionScheduleResourceGroupCandidatesMap> {
  const normalizedResourceCds = Array.from(
    new Set(resourceCds.map((resourceCd) => normalizeResourceCd(resourceCd)).filter((resourceCd) => resourceCd.length > 0))
  );
  if (normalizedResourceCds.length === 0) {
    return {};
  }

  const directRows = await prisma.productionScheduleResourceMaster.findMany({
    where: {
      resourceCd: {
        in: normalizedResourceCds
      }
    },
    select: {
      resourceCd: true,
      groupCd: true
    }
  });
  const resourceToGroupCdMap = new Map<string, string>();
  const groupCdSet = new Set<string>();
  for (const row of directRows) {
    const resourceCd = normalizeResourceCd(row.resourceCd);
    const groupCd = normalizeGroupCd(row.groupCd);
    if (!resourceCd || !groupCd) continue;
    resourceToGroupCdMap.set(resourceCd, groupCd);
    groupCdSet.add(groupCd);
  }
  if (groupCdSet.size === 0) {
    return {};
  }

  const groupedRows = await prisma.productionScheduleResourceMaster.findMany({
    where: {
      groupCd: {
        in: Array.from(groupCdSet)
      }
    },
    select: {
      resourceCd: true,
      groupCd: true
    }
  });

  const groupCdToResourceCdSetMap = new Map<string, Set<string>>();
  for (const row of groupedRows) {
    const groupCd = normalizeGroupCd(row.groupCd);
    const resourceCd = normalizeResourceCd(row.resourceCd);
    if (!groupCd || !resourceCd) continue;
    const current = groupCdToResourceCdSetMap.get(groupCd) ?? new Set<string>();
    current.add(resourceCd);
    groupCdToResourceCdSetMap.set(groupCd, current);
  }

  const result: ProductionScheduleResourceGroupCandidatesMap = {};
  resourceToGroupCdMap.forEach((groupCd, resourceCd) => {
    const candidates = Array.from(groupCdToResourceCdSetMap.get(groupCd) ?? []).sort((a, b) => a.localeCompare(b));
    if (candidates.length === 0) return;
    result[resourceCd] = candidates;
  });
  return result;
}
