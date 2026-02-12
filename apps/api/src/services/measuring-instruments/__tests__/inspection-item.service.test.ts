import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { InspectionItemService } from '../inspection-item.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    inspectionItem: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('InspectionItemService', () => {
  let service: InspectionItemService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InspectionItemService();
  });

  it('findByInstrument は order 昇順で取得する', async () => {
    vi.mocked(prisma.inspectionItem.findMany).mockResolvedValue([] as never);

    await service.findByInstrument('inst-1');

    expect(prisma.inspectionItem.findMany).toHaveBeenCalledWith({
      where: { measuringInstrumentId: 'inst-1' },
      orderBy: { order: 'asc' },
    });
  });

  it('update は対象がない場合404を返す', async () => {
    vi.mocked(prisma.inspectionItem.update).mockRejectedValue(new Error('not found'));

    await expect(service.update('missing', { name: '更新' })).rejects.toThrow(ApiError);
    await expect(service.update('missing', { name: '更新' })).rejects.toThrow('点検項目が見つかりません');
  });

  it('delete は対象がない場合404を返す', async () => {
    vi.mocked(prisma.inspectionItem.delete).mockRejectedValue(new Error('not found'));

    await expect(service.delete('missing')).rejects.toThrow('点検項目が見つかりません');
  });
});
