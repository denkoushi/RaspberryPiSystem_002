import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { RiggingGearService } from '../rigging-gear.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    riggingGear: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    riggingGearTag: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    riggingInspectionRecord: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('RiggingGearService', () => {
  let service: RiggingGearService;
  const tx = {
    riggingGear: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    riggingGearTag: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    riggingInspectionRecord: {
      deleteMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RiggingGearService();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));
  });

  it('findAll は search + status 条件をANDで構築する', async () => {
    vi.mocked(prisma.riggingGear.findMany).mockResolvedValue([] as never);

    await service.findAll({ search: 'RG', status: 'IN_USE' });

    expect(prisma.riggingGear.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: 'RG', mode: 'insensitive' } },
              { managementNumber: { contains: 'RG', mode: 'insensitive' } },
            ],
          },
          { status: 'IN_USE' },
        ],
      },
      include: { tags: true },
      orderBy: { managementNumber: 'asc' },
    });
  });

  it('update は更新項目が空なら400を返す', async () => {
    await expect(service.update('gear-1', {})).rejects.toThrow(ApiError);
    await expect(service.update('gear-1', {})).rejects.toThrow('更新項目がありません');
  });

  it('update はrfidTagUid指定時に既存タグを削除して再作成する', async () => {
    tx.riggingGear.update.mockResolvedValue({
      id: 'gear-1',
      name: '吊具A',
      managementNumber: 'R-001',
    });

    await service.update('gear-1', { rfidTagUid: 'RIG-NEW' });

    expect(tx.riggingGearTag.deleteMany).toHaveBeenCalledWith({
      where: { riggingGearId: 'gear-1' },
    });
    expect(tx.riggingGearTag.create).toHaveBeenCalledWith({
      data: { riggingGearId: 'gear-1', rfidTagUid: 'RIG-NEW' },
    });
  });
});
