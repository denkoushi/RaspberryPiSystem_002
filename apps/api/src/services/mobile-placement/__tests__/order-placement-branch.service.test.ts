vi.mock('../../../config/env/load-dotenv.js', () => ({}));
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { invalidateMobileDataVersions } from '../mobile-local-data.service.js';
import { deleteOrderPlacementBranch, listOrderPlacementBranches } from '../order-placement-branch.service.js';

vi.mock('../mobile-local-data.service.js', () => ({ invalidateMobileDataVersions: vi.fn() }));

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  orderPlacementBranchState: { delete: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
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
    expect(invalidateMobileDataVersions).toHaveBeenCalledTimes(1);
    for (const method of Object.values(prisma.orderPlacementEvent)) expect(method).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing or concurrently deleted branch', async () => {
    vi.mocked(prisma.orderPlacementBranchState.delete).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '5' }));
    await expect(deleteOrderPlacementBranch('missing')).rejects.toMatchObject({ statusCode: 404, message: 'この品物はもうありません' });
    expect(invalidateMobileDataVersions).toHaveBeenCalledTimes(1);
  });
  it('propagates database failures', async () => {
    const error = new Error('database unavailable');
    vi.mocked(prisma.orderPlacementBranchState.delete).mockRejectedValue(error);
    await expect(deleteOrderPlacementBranch('branch')).rejects.toBe(error);
  });
});

it('lists active branches while retaining the stored completed branch', async () => {
  const common = { manufacturingOrderBarcodeRaw: '001', branchNo: 1, shelfCodeRaw: 'A', csvDashboardRowId: null, updatedAt: new Date() };
  const rows = [
    { ...common, id: 'order', slipKind: 'manufacturing_order', scheduleSnapshot: null },
    { ...common, id: 'purchase', slipKind: 'purchase_order', scheduleSnapshot: null },
  ];
  vi.mocked(prisma.orderPlacementBranchState.findMany).mockResolvedValue(rows as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ productNo: '001' }]);
  expect((await listOrderPlacementBranches('001')).map(row => row.id)).toEqual(['purchase']);
  expect(prisma.orderPlacementBranchState.delete).not.toHaveBeenCalled();
});
