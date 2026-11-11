vi.mock('../../../config/env/load-dotenv.js', () => ({}));
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { invalidateMobileDataVersions } from '../mobile-local-data.service.js';
import { deleteOrderPlacementBranch, listOrderPlacementBranches } from '../order-placement-branch.service.js';

vi.mock('../mobile-local-data.service.js', () => ({ invalidateMobileDataVersions: vi.fn() }));

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  orderPlacementBranchState: { delete: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
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
  it.each([undefined, new Date('2026-10-28T00:00:00.000Z')])('returns 404 for a missing or concurrently deleted branch (expectedUpdatedAt: %s)', async (expectedUpdatedAt) => {
    vi.mocked(prisma.orderPlacementBranchState.delete).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '5' }));
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockResolvedValue(null);
    await expect(deleteOrderPlacementBranch('missing', expectedUpdatedAt)).rejects.toMatchObject({ statusCode: 404, message: 'この品物はもうありません' });
    expect(invalidateMobileDataVersions).toHaveBeenCalledTimes(1);
  });
  it('atomically deletes only the version the client observed', async () => {
    const updatedAt = new Date('2026-10-28T00:00:00.000Z');
    vi.mocked(prisma.orderPlacementBranchState.delete).mockResolvedValue({ id: 'branch' } as never);
    await deleteOrderPlacementBranch('branch', updatedAt);
    expect(prisma.orderPlacementBranchState.delete).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'branch', updatedAt },
      select: { id: true, manufacturingOrderBarcodeRaw: true, branchNo: true, shelfCodeRaw: true }
    });
  });
  it('returns 409 and refreshes versions when an existing branch has a different updatedAt', async () => {
    vi.mocked(prisma.orderPlacementBranchState.delete).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('stale', { code: 'P2025', clientVersion: '7' }));
    vi.mocked(prisma.orderPlacementBranchState.findUnique).mockResolvedValue({ updatedAt: new Date('2026-10-29T00:00:00.000Z') } as never);
    await expect(deleteOrderPlacementBranch('branch', new Date('2026-10-28T00:00:00.000Z'))).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.orderPlacementBranchState.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'branch' }, select: { updatedAt: true }
    });
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
