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
    vi.resetAllMocks();
  });

  it('returns empty array for blank product numbers', async () => {
    await expect(service.listByProductNos(['', '   '])).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('deduplicates and normalizes product numbers before querying', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ productNo: 'ABC123', lotQty: 15 }] as never);

    await expect(service.listByProductNos([' abc123 ', 'ABC123'])).resolves.toEqual([
      { productNo: 'ABC123', lotQty: 15 }
    ]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('maps supplement query rows to numeric lotQty', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ productNo: 'XYZ9', lotQty: '42.5' }] as never);

    await expect(service.listByProductNos(['XYZ9'])).resolves.toEqual([{ productNo: 'XYZ9', lotQty: 42.5 }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to actual hours only for product numbers missing supplement values', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ productNo: 'HAS-SUPP', lotQty: 5 }] as never)
      .mockResolvedValueOnce([{ productNo: 'NO-SUPP', lotQty: 12 }] as never);

    await expect(service.listByProductNos(['HAS-SUPP', 'NO-SUPP'])).resolves.toEqual([
      { productNo: 'HAS-SUPP', lotQty: 5 },
      { productNo: 'NO-SUPP', lotQty: 12 }
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('queries actual hours for all product numbers when supplement returns none', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ productNo: 'RAW-ONLY', lotQty: 3 }] as never);

    await expect(service.listByProductNos(['RAW-ONLY'])).resolves.toEqual([{ productNo: 'RAW-ONLY', lotQty: 3 }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
