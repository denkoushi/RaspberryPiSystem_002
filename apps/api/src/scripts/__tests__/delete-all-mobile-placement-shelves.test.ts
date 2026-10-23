import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../lib/prisma.js';
import { deleteAllMobilePlacementShelves } from '../delete-all-mobile-placement-shelves.js';

const mocks = vi.hoisted(() => {
  const makeDb = () => ({
    mobilePlacementShelf: { findMany: vi.fn(), deleteMany: vi.fn() },
    mobilePlacementShelfPhoto: { count: vi.fn() },
    mobilePlacementLayoutEntity: { findMany: vi.fn(), updateMany: vi.fn() },
    clientDevice: { findMany: vi.fn(), updateMany: vi.fn() }
  });
  return { db: makeDb(), tx: makeDb() };
});
vi.mock('../../lib/prisma.js', () => ({ prisma: { ...mocks.db, $transaction: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  for (const db of [mocks.db, mocks.tx]) {
    db.mobilePlacementShelf.findMany.mockResolvedValue([{ shelfCodeRaw: '西-北-01' }, { shelfCodeRaw: 'DAD-3220 北' }]);
    db.mobilePlacementShelfPhoto.count.mockResolvedValue(1);
    db.mobilePlacementLayoutEntity.findMany.mockResolvedValue([{ id: 'entity', shelfId: 'shelf', zoneLayoutId: 'zone', shelf: { shelfCodeRaw: '西-北-01' } }]);
    db.clientDevice.findMany.mockResolvedValue([{ id: 'client', name: '端末', haizenPresetShelfCodeRaw: '西-北-01' }]);
  }
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (callback as (tx: typeof mocks.tx) => Promise<never>)(mocks.tx));
});

describe('delete all shelf CLI', () => {
  it('defaults to dry-run with complete counts and references and never mutates', async () => {
    const result = await deleteAllMobilePlacementShelves([]);
    expect(result).toMatchObject({ mode: 'dry-run', before: {
      shelfCount: 2, shelfCodes: ['西-北-01', 'DAD-3220 北'], photoCount: 1, layoutEntityCount: 1, clientDeviceCount: 1,
      layoutEntities: [expect.objectContaining({ id: 'entity' })], clientDevices: [expect.objectContaining({ id: 'client' })]
    } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.db.mobilePlacementShelf.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.clientDevice.updateMany).not.toHaveBeenCalled();
  });

  it.each([['--execute'], ['--execute', '--confirm=wrong']])('requires the exact confirmation: %j', async (...args) => {
    await expect(deleteAllMobilePlacementShelves(args)).rejects.toThrow('--confirm=DELETE-ALL-SHELVES');
    expect(mocks.db.mobilePlacementShelf.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('confirmation alone remains a dry-run', async () => {
    expect(await deleteAllMobilePlacementShelves(['--confirm=DELETE-ALL-SHELVES'])).toMatchObject({ mode: 'dry-run' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('clears presets then deletes shelves in one transaction and returns the post-delete summary', async () => {
    mocks.tx.mobilePlacementShelf.deleteMany.mockImplementation(async () => {
      mocks.tx.mobilePlacementShelf.findMany.mockResolvedValue([]);
      mocks.tx.mobilePlacementShelfPhoto.count.mockResolvedValue(0);
      mocks.tx.mobilePlacementLayoutEntity.findMany.mockResolvedValue([]);
    });
    mocks.tx.clientDevice.updateMany.mockImplementation(async () => mocks.tx.clientDevice.findMany.mockResolvedValue([]));
    const result = await deleteAllMobilePlacementShelves(['--execute', '--confirm=DELETE-ALL-SHELVES']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.clientDevice.updateMany).toHaveBeenCalledWith({ where: { haizenPresetShelfCodeRaw: { not: null } }, data: { haizenPresetShelfCodeRaw: null } });
    expect(mocks.tx.clientDevice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.mobilePlacementShelf.deleteMany.mock.invocationCallOrder[0]);
    expect(mocks.tx.mobilePlacementLayoutEntity.updateMany).toHaveBeenCalledWith({ where: { entityKind: 'SHELF' }, data: { entityKind: 'UNUSED', shelfId: null } });
    expect(result).toMatchObject({ mode: 'execute', before: { shelfCount: 2 }, after: {
      shelfCount: 0, shelfCodes: [], photoCount: 0, layoutEntityCount: 0, layoutEntities: [], clientDeviceCount: 0, clientDevices: []
    } });
    expect(mocks.db.mobilePlacementShelf.deleteMany).not.toHaveBeenCalled();
  });

  it('propagates transaction failures and does not delete shelves after a preset failure', async () => {
    mocks.tx.clientDevice.updateMany.mockRejectedValue(new Error('write failed'));
    await expect(deleteAllMobilePlacementShelves(['--execute', '--confirm=DELETE-ALL-SHELVES'])).rejects.toThrow('write failed');
    expect(mocks.tx.mobilePlacementShelf.deleteMany).not.toHaveBeenCalled();
  });
});
