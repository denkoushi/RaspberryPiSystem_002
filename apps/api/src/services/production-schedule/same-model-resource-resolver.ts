import type { Prisma } from '@prisma/client';
import type { ProductionScheduleSameModelResourceGroup } from '@raspi-system/shared-types';
import { prisma } from '../../lib/prisma.js';

type Client = Pick<Prisma.TransactionClient, 'productionScheduleSameModelResourceGroup'>;
export async function readSameModelResourceGroups(siteKey: string, client: Client = prisma): Promise<ProductionScheduleSameModelResourceGroup[]> {
  const groups = await client.productionScheduleSameModelResourceGroup.findMany({
    where: { siteKey }, include: { members: { orderBy: { resourceCd: 'asc' } } }
  });
  return groups.map((group) => ({ resourceCds: group.members.map((member) => member.resourceCd).sort() }))
    .sort((a, b) => a.resourceCds[0] < b.resourceCds[0] ? -1 : 1);
}
export function sameModelResourceCds(groups: ProductionScheduleSameModelResourceGroup[], resourceCd: string): string[] {
  return groups.find((group) => group.resourceCds.includes(resourceCd))?.resourceCds ?? [resourceCd];
}
export function representativeResourceCd(groups: ProductionScheduleSameModelResourceGroup[], resourceCd: string): string {
  return [...sameModelResourceCds(groups, resourceCd)].sort()[0];
}
