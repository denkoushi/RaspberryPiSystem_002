import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveIllustrationMock, deleteIllustrationFileMock, assertMachineCdRegisteredMock } = vi.hoisted(() => ({
  saveIllustrationMock: vi.fn(),
  deleteIllustrationFileMock: vi.fn(),
  assertMachineCdRegisteredMock: vi.fn(),
}));

const txMock = {
  palletMachineIllustration: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  machinePalletEvent: {
    create: vi.fn(),
  },
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    machinePalletItem: {
      findFirst: vi.fn(),
    },
    palletMachineIllustration: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
  },
}));

vi.mock('../../../lib/pallet-machine-illustration-storage.js', () => ({
  PalletMachineIllustrationStorage: {
    saveIllustration: saveIllustrationMock,
    deleteIllustrationFile: deleteIllustrationFileMock,
  },
}));

vi.mock('../pallet-visualization-resource.service.js', () => ({
  assertMachineCdRegistered: assertMachineCdRegisteredMock,
}));

import { prisma } from '../../../lib/prisma.js';
import {
  commandUpdatePalletMachinePalletCount,
  commandDeletePalletIllustration,
  commandUpsertPalletIllustration,
} from '../pallet-visualization-command.service.js';

describe('pallet-visualization-command.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertMachineCdRegisteredMock.mockResolvedValue('MC01');
    saveIllustrationMock.mockResolvedValue({
      relativeUrl: '/api/storage/pallet-machine-illustrations/new.jpg',
    });
    deleteIllustrationFileMock.mockResolvedValue(undefined);
    txMock.palletMachineIllustration.findUnique.mockResolvedValue(null);
    txMock.palletMachineIllustration.upsert.mockResolvedValue(undefined);
    txMock.palletMachineIllustration.delete.mockResolvedValue(undefined);
    txMock.palletMachineIllustration.update.mockResolvedValue(undefined);
    txMock.machinePalletEvent.create.mockResolvedValue(undefined);
    vi.mocked(prisma.machinePalletItem.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.palletMachineIllustration.upsert).mockResolvedValue(undefined);
  });

  it('イラスト更新成功後に旧ファイルを削除する', async () => {
    txMock.palletMachineIllustration.findUnique.mockResolvedValue({
      resourceCd: 'MC01',
      imageRelativeUrl: '/api/storage/pallet-machine-illustrations/old.jpg',
    });

    const result = await commandUpsertPalletIllustration({
      machineCd: 'mc01',
      buffer: Buffer.from('image'),
      mimetype: 'image/jpeg',
    });

    expect(result).toEqual({
      illustrationUrl: '/api/storage/pallet-machine-illustrations/new.jpg',
    });
    expect(txMock.palletMachineIllustration.upsert).toHaveBeenCalledWith({
      where: { resourceCd: 'MC01' },
      create: {
        resourceCd: 'MC01',
        imageRelativeUrl: '/api/storage/pallet-machine-illustrations/new.jpg',
        palletCount: 10,
      },
      update: {
        imageRelativeUrl: '/api/storage/pallet-machine-illustrations/new.jpg',
      },
    });
    expect(deleteIllustrationFileMock).toHaveBeenCalledWith('/api/storage/pallet-machine-illustrations/old.jpg');
    expect(deleteIllustrationFileMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      txMock.machinePalletEvent.create.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('DB更新失敗時は保存済みの新ファイルを掃除する', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('db failed'));

    await expect(
      commandUpsertPalletIllustration({
        machineCd: 'MC01',
        buffer: Buffer.from('image'),
        mimetype: 'image/jpeg',
      })
    ).rejects.toThrow('db failed');

    expect(deleteIllustrationFileMock).toHaveBeenCalledWith('/api/storage/pallet-machine-illustrations/new.jpg');
  });

  it('イラスト削除成功後にファイルを削除する', async () => {
    txMock.palletMachineIllustration.findUnique.mockResolvedValue({
      resourceCd: 'MC01',
      imageRelativeUrl: '/api/storage/pallet-machine-illustrations/old.jpg',
    });

    await commandDeletePalletIllustration({ machineCd: 'MC01' });

    expect(txMock.palletMachineIllustration.update).toHaveBeenCalledWith({
      where: { resourceCd: 'MC01' },
      data: { imageRelativeUrl: null },
    });
    expect(txMock.machinePalletEvent.create).toHaveBeenCalledWith({
      data: {
        actionType: 'DELETE_ILLUSTRATION',
        resourceCd: 'MC01',
        illustrationRelativeUrl: '/api/storage/pallet-machine-illustrations/old.jpg',
      },
    });
    expect(deleteIllustrationFileMock).toHaveBeenCalledWith('/api/storage/pallet-machine-illustrations/old.jpg');
  });

  it('加工機ごとのパレット台数を保存する', async () => {
    await commandUpdatePalletMachinePalletCount({ machineCd: 'MC01', palletCount: 28 });

    expect(prisma.machinePalletItem.findFirst).toHaveBeenCalledWith({
      where: { resourceCd: 'MC01', palletNo: { gt: 28 } },
      orderBy: { palletNo: 'desc' },
      select: { palletNo: true },
    });
    expect(prisma.palletMachineIllustration.upsert).toHaveBeenCalledWith({
      where: { resourceCd: 'MC01' },
      create: { resourceCd: 'MC01', palletCount: 28, imageRelativeUrl: null },
      update: { palletCount: 28 },
    });
  });

  it('高番号パレットに登録がある場合は台数縮小を拒否する', async () => {
    vi.mocked(prisma.machinePalletItem.findFirst).mockResolvedValueOnce({ palletNo: 15 });

    await expect(
      commandUpdatePalletMachinePalletCount({ machineCd: 'MC01', palletCount: 10 })
    ).rejects.toThrow('パレット15以降に登録があるため、台数を10未満にできません');
  });
});
