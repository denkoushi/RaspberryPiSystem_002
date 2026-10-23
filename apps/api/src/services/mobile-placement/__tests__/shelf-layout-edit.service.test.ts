import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { replaceShelfLayoutZone } from '../shelf-layout-edit.service.js';

const mocks = vi.hoisted(() => ({
  mobilePlacementZoneLayout: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mobilePlacementShelf: { update: vi.fn(), create: vi.fn() },
  mobilePlacementLayoutEntity: { deleteMany: vi.fn(), create: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: vi.fn() } }));
const layout = { id: 'zone', gridSize: 3, nextShelfSlot: 8, updatedAt: new Date(), entities: [
  { shelf: { id: 'shelf', shelfCodeRaw: '西-北-01' } }
] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (callback as (tx: typeof mocks) => Promise<never>)(mocks));
  mocks.mobilePlacementZoneLayout.count.mockResolvedValue(9);
  mocks.mobilePlacementZoneLayout.findUnique.mockResolvedValue(layout);
  mocks.mobilePlacementZoneLayout.update.mockResolvedValue({ ...layout, entities: [] });
});

describe('layout shelf creation boundary', () => {
  it.each([null, '西-北-02', 'DAD-3220 北'])('rejects new shelf %s', async (shelfCodeRaw) => {
    await expect(replaceShelfLayoutZone({ macroZoneIdRaw: 'nw', gridSize: 3, clientDeviceId: 'client',
      entities: [{ entityKind: 'SHELF', cellIndices: [0], shelfCodeRaw }]
    })).rejects.toMatchObject({ statusCode: 400, message: '新しい棚は「棚の写真」の「棚を追加」から登録してください' });
    expect(mocks.mobilePlacementShelf.create).not.toHaveBeenCalled();
    expect(mocks.mobilePlacementLayoutEntity.deleteMany).not.toHaveBeenCalled();
  });

  it('still saves existing shelf entities without allocating a code or advancing nextShelfSlot', async () => {
    await replaceShelfLayoutZone({ macroZoneIdRaw: 'nw', gridSize: 3, clientDeviceId: 'client',
      entities: [{ entityKind: 'SHELF', cellIndices: [1], shelfCodeRaw: '西-北-01' }]
    });
    expect(mocks.mobilePlacementShelf.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shelf' } }));
    expect(mocks.mobilePlacementLayoutEntity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shelfId: 'shelf', cellIndices: [1] }) }));
    expect(mocks.mobilePlacementZoneLayout.update).toHaveBeenCalledWith(expect.objectContaining({ data: { gridSize: 3 } }));
    expect(mocks.mobilePlacementShelf.create).not.toHaveBeenCalled();
  });
});
