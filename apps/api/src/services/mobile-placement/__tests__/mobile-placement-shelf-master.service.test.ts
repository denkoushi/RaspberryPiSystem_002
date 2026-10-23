import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { listRegisteredShelvesFromShelfMaster, registerMobilePlacementShelf } from '../mobile-placement-shelf-master.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { mobilePlacementShelf: { create: vi.fn(), findMany: vi.fn() } } }));
beforeEach(() => vi.resetAllMocks());

describe('registerMobilePlacementShelf', () => {
  it.each(['西-北-01', '西-北-02-1', 'TEMP-A', '北', '機械 北東', ''])('rejects %s without writing', async (shelfCodeRaw) => {
    await expect(registerMobilePlacementShelf({ clientDeviceId: 'client', shelfCodeRaw })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.mobilePlacementShelf.create).not.toHaveBeenCalled();
  });

  it('accepts arbitrary machine names and canonicalizes whitespace', async () => {
    const result = await registerMobilePlacementShelf({ clientDeviceId: 'client', shelfCodeRaw: '  DAD-3220   北  ', displayLabel: ' メモ ' });
    expect(prisma.mobilePlacementShelf.create).toHaveBeenCalledWith({ data: {
      shelfCodeRaw: 'DAD-3220 北', displayLabel: 'メモ', createdByClientDeviceId: 'client'
    } });
    expect(result.shelf).toMatchObject({ shelfCodeRaw: 'DAD-3220 北', machineName: 'DAD-3220', direction: '北', isStructured: true });
  });

  it('reports a unique constraint conflict as 409', async () => {
    vi.mocked(prisma.mobilePlacementShelf.create).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    await expect(registerMobilePlacementShelf({ clientDeviceId: 'client', shelfCodeRaw: '任意の加工機 西' })).rejects.toMatchObject({
      statusCode: 409, message: 'この加工機・方角の棚はもうあります'
    });
  });

  it('lists machine metadata while preserving legacy metadata', async () => {
    vi.mocked(prisma.mobilePlacementShelf.findMany).mockResolvedValue([
      { shelfCodeRaw: 'DAD-3220 北', displayLabel: null, tier: null, macroZoneId: null, photo: null },
      { shelfCodeRaw: '西-北-01', displayLabel: null, tier: null, macroZoneId: null, photo: null }
    ] as never);
    const shelves = await listRegisteredShelvesFromShelfMaster();
    expect(shelves[0]).toMatchObject({ machineName: 'DAD-3220', direction: '北', photoUpdatedAt: null });
    expect(shelves[1]).toMatchObject({ areaId: 'west', lineId: 'north', slot: 1 });
  });
});
