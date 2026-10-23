import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { deleteOrderPlacementBranch } from '../order-placement-branch.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  orderPlacementBranchState: { delete: vi.fn() },
  orderPlacementEvent: { delete: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() }
} }));

beforeEach(() => vi.resetAllMocks());
describe('deleteOrderPlacementBranch', () => {
  it('deletes only the identified current branch and returns its location, preserving history', async () => {
    const deleted = { id: 'branch', manufacturingOrderBarcodeRaw: '100', branchNo: 4, shelfCodeRaw: 'A' };
    vi.mocked(prisma.orderPlacementBranchState.delete).mockResolvedValue(deleted as never);
    await expect(deleteOrderPlacementBranch('branch')).resolves.toEqual(deleted);
    expect(prisma.orderPlacementBranchState.delete).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'branch' },
      select: { id: true, manufacturingOrderBarcodeRaw: true, branchNo: true, shelfCodeRaw: true }
    });
    for (const method of Object.values(prisma.orderPlacementEvent)) expect(method).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing or concurrently deleted branch', async () => {
    vi.mocked(prisma.orderPlacementBranchState.delete).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '5' }));
    await expect(deleteOrderPlacementBranch('missing')).rejects.toMatchObject({ statusCode: 404, message: 'この品物はもうありません' });
  });
  it('propagates database failures', async () => {
    const error = new Error('database unavailable');
    vi.mocked(prisma.orderPlacementBranchState.delete).mockRejectedValue(error);
    await expect(deleteOrderPlacementBranch('branch')).rejects.toBe(error);
  });
});
