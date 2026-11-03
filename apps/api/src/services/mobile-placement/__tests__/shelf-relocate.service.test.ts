vi.mock('../../../config/env/load-dotenv.js', () => ({}));
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mobile-local-data.service.js', () => ({ invalidateMobileDataVersions: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../shelf-layout-edit.service.js', () => ({ macroZoneIdForShelfCode: () => null }));

import { prisma } from '../../../lib/prisma.js';
import { relocateMobilePlacementShelf } from '../shelf-relocate.service.js';

const tx = {
  $queryRaw: vi.fn(),
  mobilePlacementShelf: { findUnique: vi.fn(), update: vi.fn() },
  orderPlacementBranchState: { findMany: vi.fn(), updateMany: vi.fn() },
  haizenCurrentPlacement: { findMany: vi.fn(), updateMany: vi.fn() },
  clientDevice: { count: vi.fn(), updateMany: vi.fn() },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async fn => fn(tx as unknown as Prisma.TransactionClient));
  tx.mobilePlacementShelf.findUnique.mockImplementation(async ({ where }) => ({ id: where.shelfCodeRaw, displayLabel: 'label' }));
  tx.orderPlacementBranchState.findMany.mockImplementation(async ({ where }) => [{ manufacturingOrderBarcodeRaw: where.shelfCodeRaw, scheduleSnapshot: null }]);
  tx.haizenCurrentPlacement.findMany.mockResolvedValue([]);
  tx.$queryRaw.mockResolvedValue([{ productNo: 'target' }]);
  tx.clientDevice.count.mockResolvedValue(0);
});
describe('relocate shelf guards', () => {
  it('allows completed target leftovers and still moves all source records', async () => {
    await expect(relocateMobilePlacementShelf({ sourceShelfCodeRaw: 'source', targetShelfCodeRaw: 'target' })).resolves.toMatchObject({ movedDisplayLabel: 'label' });
    for (const table of [tx.orderPlacementBranchState, tx.haizenCurrentPlacement]) {
      expect(table.updateMany).toHaveBeenCalledWith({ where: { shelfCodeRaw: 'source' }, data: { shelfCodeRaw: 'target' } });
    }
  });
  it('blocks an active target placement', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(relocateMobilePlacementShelf({ sourceShelfCodeRaw: 'source', targetShelfCodeRaw: 'target' })).rejects.toMatchObject({ code: 'SHELF_RELOCATE_TARGET_OCCUPIED' });
    expect(tx.orderPlacementBranchState.updateMany).not.toHaveBeenCalled();
  });
  it('preserves the enabled scanner preset guard', async () => {
    tx.clientDevice.count.mockResolvedValue(1);
    await expect(relocateMobilePlacementShelf({ sourceShelfCodeRaw: 'source', targetShelfCodeRaw: 'target' })).rejects.toMatchObject({ code: 'SHELF_RELOCATE_TARGET_OCCUPIED' });
  });
});
