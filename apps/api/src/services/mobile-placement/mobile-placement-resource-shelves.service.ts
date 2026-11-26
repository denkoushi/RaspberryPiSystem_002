import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';

import { listResourceMastersWithFactory, type ResourceFactory } from './machine-master-query.service.js';
import { listRegisteredShelvesFromShelfMaster } from './mobile-placement-shelf-master.service.js';

export async function getResourceShelfAssignments() {
  const [shelves, { machines }, links] = await Promise.all([
    listRegisteredShelvesFromShelfMaster(),
    listResourceMastersWithFactory(),
    prisma.mobilePlacementResourceShelf.findMany({
      select: { resourceCd: true, shelf: { select: { shelfCodeRaw: true } } }
    })
  ]);
  const namesByResource = new Map<string, string[]>();
  const factoryByResource = new Map<string, ResourceFactory>();
  for (const { resourceCd, resourceName, factory } of machines) {
    factoryByResource.set(resourceCd, factory);
    const name = resourceName.trim();
    const names = namesByResource.get(resourceCd) ?? [];
    if (name && !names.includes(name)) names.push(name);
    namesByResource.set(resourceCd, names);
  }
  const saved = new Map<string, Set<string>>();
  for (const { resourceCd, shelf } of links) {
    const codes = saved.get(resourceCd) ?? new Set<string>();
    if (shelf) codes.add(shelf.shelfCodeRaw);
    saved.set(resourceCd, codes);
  }
  const shelvesByName = new Map<string, Set<string>>();
  const resourceCdsByShelf = new Map(shelves.map(({ shelfCodeRaw }) => [shelfCodeRaw, [] as string[]]));
  for (const shelf of shelves) {
    // A bare machine code can outlive its appearance in the production schedule.
    const name = normalizeMachineNameForCompare(shelf.machineName ?? (shelf.isStructured ? undefined : shelf.shelfCodeRaw));
    if (!name) continue;
    const codes = shelvesByName.get(name) ?? new Set<string>();
    codes.add(shelf.shelfCodeRaw);
    shelvesByName.set(name, codes);
  }
  const resources = [...namesByResource].sort(([a], [b]) => a.localeCompare(b)).map(([resourceCd, resourceNames]) => {
    const factory = factoryByResource.get(resourceCd) ?? 'MISHIMA';
    // Shelves are named after Mishima machines, so only Mishima resources fall back to a name match.
    const assigned = saved.get(resourceCd) ?? new Set(factory === 'MISHIMA' ? resourceNames.flatMap((name) =>
      [...(shelvesByName.get(normalizeMachineNameForCompare(name)) ?? [])]) : []);
    saved.set(resourceCd, assigned);
    return { resourceCd, factory, resourceNames, shelfCodes: [...assigned].filter((code) => resourceCdsByShelf.has(code)).sort() };
  });
  for (const [resourceCd, codes] of saved) {
    for (const code of codes) resourceCdsByShelf.get(code)?.push(resourceCd);
  }
  return { resources, shelves: shelves.map((shelf) => ({ ...shelf, resourceCds: resourceCdsByShelf.get(shelf.shelfCodeRaw) ?? [] })) };
}

export async function replaceResourceShelves(resourceCd: string, shelfCodes: string[]) {
  const { machines } = await listResourceMastersWithFactory();
  if (!machines.some((machine) => machine.resourceCd === resourceCd)) {
    throw new ApiError(404, '資源CDが見つかりません');
  }
  const codes = [...new Set(shelfCodes)].sort();
  await prisma.$transaction(async (tx) => {
    const shelves = await tx.mobilePlacementShelf.findMany({
      where: { shelfCodeRaw: { in: codes } }, select: { id: true }
    });
    if (shelves.length !== codes.length) throw new ApiError(400, '棚が見つかりません');
    // The upsert locks the marker for this resource until its replacement is committed.
    await tx.mobilePlacementResourceShelf.upsert({
      where: { id: resourceCd },
      create: { id: resourceCd, resourceCd },
      update: { resourceCd }
    });
    await tx.mobilePlacementResourceShelf.deleteMany({ where: { resourceCd, shelfId: { not: null } } });
    if (shelves.length) {
      await tx.mobilePlacementResourceShelf.createMany({ data: shelves.map(({ id }) => ({ resourceCd, shelfId: id })) });
    }
  });
  return { resourceCd, shelfCodes: codes };
}
