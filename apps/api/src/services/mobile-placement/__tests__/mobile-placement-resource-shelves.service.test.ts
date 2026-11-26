import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getResourceShelfAssignments, replaceResourceShelves } from '../mobile-placement-resource-shelves.service.js';

const mocks = vi.hoisted(() => {
  const links = { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() };
  const shelves = { findMany: vi.fn() };
  return { links, shelves, listShelves: vi.fn(), listMachines: vi.fn(), transaction: vi.fn(async (run) =>
    run({ mobilePlacementShelf: shelves, mobilePlacementResourceShelf: links })) };
});
vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $transaction: mocks.transaction, mobilePlacementResourceShelf: mocks.links }
}));
vi.mock('../machine-master-query.service.js', () => ({ listMachineMastersForShelfLayout: mocks.listMachines }));
vi.mock('../mobile-placement-shelf-master.service.js', () => ({ listRegisteredShelvesFromShelfMaster: mocks.listShelves }));

const north = { shelfCodeRaw: 'Ｍｈ 北', machineName: 'Ｍｈ', isStructured: true };
const south = { shelfCodeRaw: 'AP 南', machineName: 'AP', isStructured: true };
const legacy = { shelfCodeRaw: '西-北-01', isStructured: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listShelves.mockResolvedValue([north, south, legacy]);
  mocks.listMachines.mockResolvedValue({ machines: [
    { resourceCd: '025', resourceName: 'mh' }, { resourceCd: '025', resourceName: 'ＡＰ' },
    { resourceCd: '026', resourceName: 'MH' }, { resourceCd: '027', resourceName: 'MH' }
  ] });
  mocks.links.findMany.mockResolvedValue([
    { resourceCd: '026', shelf: null }, { resourceCd: '027', shelf: null }, { resourceCd: '027', shelf: legacy }
  ]);
});

describe('resource shelf assignments', () => {
  it('uses every matching name only for unsaved resources and publishes the same assignments on shelves', async () => {
    expect(await getResourceShelfAssignments()).toEqual({
      resources: [
        { resourceCd: '025', resourceNames: ['mh', 'ＡＰ'], shelfCodes: ['AP 南', 'Ｍｈ 北'] },
        { resourceCd: '026', resourceNames: ['MH'], shelfCodes: [] },
        { resourceCd: '027', resourceNames: ['MH'], shelfCodes: ['西-北-01'] }
      ],
      shelves: [{ ...north, resourceCds: ['025'] }, { ...south, resourceCds: ['025'] }, { ...legacy, resourceCds: ['027'] }]
    });
  });

  it('replaces links as a unit, keeping the saved marker when the selection is cleared', async () => {
    mocks.shelves.findMany.mockResolvedValueOnce([{ id: 'north' }]).mockResolvedValueOnce([]);
    expect(await replaceResourceShelves('025', ['Ｍｈ 北', 'Ｍｈ 北'])).toEqual({ resourceCd: '025', shelfCodes: ['Ｍｈ 北'] });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.links.upsert).toHaveBeenCalledWith({
      where: { id: '025' }, create: { id: '025', resourceCd: '025' }, update: { resourceCd: '025' }
    });
    expect(mocks.links.createMany).toHaveBeenCalledExactlyOnceWith({ data: [{ resourceCd: '025', shelfId: 'north' }] });
    expect(await replaceResourceShelves('025', [])).toEqual({ resourceCd: '025', shelfCodes: [] });
    expect(mocks.links.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.links.deleteMany).toHaveBeenLastCalledWith({ where: { resourceCd: '025', shelfId: { not: null } } });
    expect(mocks.links.createMany).toHaveBeenCalledOnce();
  });

  it('rejects unknown resources or shelf codes before changing any links', async () => {
    await expect(replaceResourceShelves('999', [])).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.shelves.findMany.mockResolvedValueOnce([]);
    await expect(replaceResourceShelves('025', ['missing'])).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.links.upsert).not.toHaveBeenCalled();
    expect(mocks.links.deleteMany).not.toHaveBeenCalled();
  });
});
