vi.mock('../../../config/env/load-dotenv.js', () => ({}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { replaceShelfOrder } from '../mobile-placement-shelf-master.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  mobilePlacementShelf: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn()
} }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(prisma as never));
});

describe('replaceShelfOrder', () => {
  it('clears every order, then numbers the given shelves in order, skipping duplicates and unknown codes', async () => {
    vi.mocked(prisma.mobilePlacementShelf.findMany).mockResolvedValue([
      { id: 'a', shelfCodeRaw: 'A 北' }, { id: 'b', shelfCodeRaw: 'B 南' }
    ] as never);
    const result = await replaceShelfOrder(['B 南', 'A 北', 'B 南', 'ZZ 東']);
    expect(result).toEqual({ shelfCodes: ['B 南', 'A 北'] });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.mobilePlacementShelf.updateMany).toHaveBeenCalledExactlyOnceWith({ data: { sortOrder: null } });
    expect(prisma.mobilePlacementShelf.update).toHaveBeenNthCalledWith(1, { where: { id: 'b' }, data: { sortOrder: 0 } });
    expect(prisma.mobilePlacementShelf.update).toHaveBeenNthCalledWith(2, { where: { id: 'a' }, data: { sortOrder: 1 } });
  });
});
