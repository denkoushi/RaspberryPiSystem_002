import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn()
  }
}));

import { prisma } from '../../../lib/prisma.js';
import { AssemblySeibanLotQuantityService } from '../assembly-seiban-lot-quantity.service.js';

describe('AssemblySeibanLotQuantityService', () => {
  const service = new AssemblySeibanLotQuantityService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for blank product numbers', async () => {
    await expect(service.listByProductNos(['', '   '])).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('deduplicates and normalizes product numbers before querying', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { productNo: 'ABC123', lotQty: 15 }
    ] as never);

    await expect(service.listByProductNos([' abc123 ', 'ABC123'])).resolves.toEqual([
      { productNo: 'ABC123', lotQty: 15 }
    ]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('maps query rows to numeric lotQty', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { productNo: 'XYZ9', lotQty: '42.5' }
    ] as never);

    await expect(service.listByProductNos(['XYZ9'])).resolves.toEqual([
      { productNo: 'XYZ9', lotQty: 42.5 }
    ]);
  });
});
