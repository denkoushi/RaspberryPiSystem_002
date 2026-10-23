import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { deleteMobilePlacementShelf, listRegisteredShelvesFromShelfMaster, registerMobilePlacementShelf } from '../mobile-placement-shelf-master.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  mobilePlacementShelf: { create: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn()
} }));
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

describe('deleteMobilePlacementShelf', () => {
  const tx = {
    mobilePlacementShelf: { findUnique: vi.fn(), delete: vi.fn() },
    orderPlacementBranchState: { count: vi.fn() },
    haizenCurrentPlacement: { count: vi.fn() },
    clientDevice: { updateMany: vi.fn() },
    mobilePlacementLayoutEntity: { updateMany: vi.fn() }
  };
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(tx as unknown as Prisma.TransactionClient));
    tx.mobilePlacementShelf.findUnique.mockResolvedValue({ id: 'shelf-id' });
    tx.orderPlacementBranchState.count.mockResolvedValue(0);
    tx.haizenCurrentPlacement.count.mockResolvedValue(0);
  });
  const expectNoWrites = () => {
    expect(tx.clientDevice.updateMany).not.toHaveBeenCalled();
    expect(tx.mobilePlacementLayoutEntity.updateMany).not.toHaveBeenCalled();
    expect(tx.mobilePlacementShelf.delete).not.toHaveBeenCalled();
  };

  it('rejects an empty code without writes', async () => {
    await expect(deleteMobilePlacementShelf('   ')).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.mobilePlacementShelf.findUnique).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('returns 404 for a missing shelf without writes', async () => {
    tx.mobilePlacementShelf.findUnique.mockResolvedValue(null);
    await expect(deleteMobilePlacementShelf('MISSING')).rejects.toMatchObject({
      statusCode: 404, message: '棚が見つかりません', code: 'SHELF_DELETE_NOT_FOUND'
    });
    expectNoWrites();
  });

  it.each([[2, 0], [0, 3], [2, 3]])('rejects %i branches and %i placements without writes', async (branches, placements) => {
    tx.orderPlacementBranchState.count.mockResolvedValue(branches);
    tx.haizenCurrentPlacement.count.mockResolvedValue(placements);
    await expect(deleteMobilePlacementShelf('A-3')).rejects.toMatchObject({
      statusCode: 409, code: 'SHELF_DELETE_HAS_ITEMS',
      message: `品物が ${branches + placements}件 置いてあるので消せません。先に「棚を動かす」で移してください`
    });
    expect(tx.orderPlacementBranchState.count).toHaveBeenCalledWith({ where: { shelfCodeRaw: 'A-3' } });
    expect(tx.haizenCurrentPlacement.count).toHaveBeenCalledWith({ where: { shelfCodeRaw: 'A-3' } });
    expectNoWrites();
  });

  it.each(['A-3', '西-北-01'])('clears only the selected shelf references and deletes %s in one transaction', async (code) => {
    await expect(deleteMobilePlacementShelf(` ${code} `)).resolves.toEqual({ shelfCodeRaw: code });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.mobilePlacementShelf.findUnique).toHaveBeenCalledWith({ where: { shelfCodeRaw: code }, select: { id: true } });
    expect(tx.clientDevice.updateMany).toHaveBeenCalledWith({
      where: { haizenPresetShelfCodeRaw: code }, data: { haizenPresetShelfCodeRaw: null }
    });
    expect(tx.mobilePlacementLayoutEntity.updateMany).toHaveBeenCalledWith({
      where: { shelfId: 'shelf-id' }, data: { entityKind: 'UNUSED', shelfId: null }
    });
    expect(tx.mobilePlacementShelf.delete).toHaveBeenCalledWith({ where: { id: 'shelf-id' } });
    expect(tx.clientDevice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.mobilePlacementShelf.delete.mock.invocationCallOrder[0]);
    expect(tx.mobilePlacementLayoutEntity.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.mobilePlacementShelf.delete.mock.invocationCallOrder[0]);
  });
});
