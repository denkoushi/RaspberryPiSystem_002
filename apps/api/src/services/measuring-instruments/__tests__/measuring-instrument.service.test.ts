import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { MeasuringInstrumentService } from '../measuring-instrument.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    measuringInstrument: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    measuringInstrumentTag: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('MeasuringInstrumentService', () => {
  let service: MeasuringInstrumentService;
  const tx = {
    measuringInstrument: {
      create: vi.fn(),
      update: vi.fn(),
    },
    measuringInstrumentTag: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MeasuringInstrumentService();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));
  });

  it('findAll は検索条件と status を where に反映する', async () => {
    vi.mocked(prisma.measuringInstrument.findMany).mockResolvedValue([] as never);

    await service.findAll({ search: 'm-100', status: 'IN_USE' });

    expect(prisma.measuringInstrument.findMany).toHaveBeenCalledWith({
      where: {
        status: 'IN_USE',
        OR: [
          { name: { contains: 'm-100', mode: 'insensitive' } },
          { managementNumber: { contains: 'm-100', mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  });

  it('create はタグ重複時に409を返す', async () => {
    tx.measuringInstrument.create.mockResolvedValue({
      id: 'inst-1',
      name: 'テスト計測器',
      managementNumber: 'M-001',
    });
    tx.measuringInstrumentTag.findUnique.mockResolvedValue({
      id: 'tag-1',
      measuringInstrumentId: 'other',
      rfidTagUid: 'RFID-001',
    });

    await expect(
      service.create({
        name: 'テスト計測器',
        managementNumber: 'M-001',
        rfidTagUid: 'RFID-001',
      })
    ).rejects.toThrow(ApiError);

    await expect(
      service.create({
        name: 'テスト計測器',
        managementNumber: 'M-001',
        rfidTagUid: 'RFID-001',
      })
    ).rejects.toThrow('このタグUIDは既に他の計測機器に紐づいています');
  });

  it('update で空文字タグを指定した場合は既存タグを削除する', async () => {
    tx.measuringInstrument.update.mockResolvedValue({
      id: 'inst-1',
      name: '更新後',
      managementNumber: 'M-002',
    });

    const result = await service.update('inst-1', {
      name: '更新後',
      rfidTagUid: '   ',
    });

    expect(result.id).toBe('inst-1');
    expect(tx.measuringInstrumentTag.deleteMany).toHaveBeenCalledWith({
      where: { measuringInstrumentId: 'inst-1' },
    });
    expect(tx.measuringInstrumentTag.create).not.toHaveBeenCalled();
  });

  it('update でP2002発生時はRFID重複エラーへ変換する', async () => {
    tx.measuringInstrument.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(
      service.update('inst-1', {
        managementNumber: 'M-003',
      })
    ).rejects.toThrow('RFIDタグUIDが重複しています');
  });
});
