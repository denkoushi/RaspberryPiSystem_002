import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { PalletMachineIllustrationStorage } from '../../lib/pallet-machine-illustration-storage.js';
import { resolveScheduleSnapshotForPalletItem } from './pallet-visualization-schedule-resolver.js';
import {
  assertMachineCdRegistered,
  getPalletCountForResource,
} from './pallet-visualization-resource.service.js';
import { DEFAULT_MACHINE_PALLET_COUNT, MAX_MACHINE_PALLET_COUNT } from './pallet-count-bounds.js';

const normalizeCd = (value: string): string => value.trim().toUpperCase();

async function assertPalletNoForMachine(machineCd: string, palletNo: number): Promise<void> {
  const max = await getPalletCountForResource(machineCd);
  if (!Number.isInteger(palletNo) || palletNo < 1 || palletNo > max) {
    throw new ApiError(400, `パレット番号は 1〜${max} で指定してください`, undefined, 'PALLET_NO_INVALID');
  }
}

export async function commandAddPalletItem(input: {
  clientDeviceId: string;
  machineCd: string;
  palletNo: number;
  manufacturingOrderBarcodeRaw: string;
}): Promise<{ id: string }> {
  const machineCd = await assertMachineCdRegistered(input.machineCd);
  await assertPalletNoForMachine(machineCd, input.palletNo);
  const resolved = await resolveScheduleSnapshotForPalletItem(machineCd, input.manufacturingOrderBarcodeRaw);
  const orderStored = input.manufacturingOrderBarcodeRaw.trim();

  return prisma.$transaction(async (tx) => {
    const agg = await tx.machinePalletItem.aggregate({
      where: { resourceCd: machineCd, palletNo: input.palletNo },
      _max: { displayOrder: true },
    });
    const displayOrder = (agg._max.displayOrder ?? 0) + 1;

    const created = await tx.machinePalletItem.create({
      data: {
        resourceCd: machineCd,
        palletNo: input.palletNo,
        displayOrder,
        fhincd: resolved.fhincd,
        fhinmei: resolved.fhinmei,
        fseiban: resolved.fseiban,
        machineName: resolved.machineName,
        csvDashboardRowId: resolved.csvDashboardRowId,
        scheduleSnapshot: resolved.scheduleSnapshot,
      },
    });

    await tx.machinePalletEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        actionType: 'SET_ITEM',
        resourceCd: machineCd,
        palletNo: input.palletNo,
        affectedItemId: created.id,
        manufacturingOrderBarcodeRaw: orderStored,
        scheduleSnapshot: resolved.scheduleSnapshot as Prisma.InputJsonValue,
      },
    });

    return { id: created.id };
  });
}

export async function commandReplacePalletItem(input: {
  clientDeviceId: string;
  itemId: string;
  manufacturingOrderBarcodeRaw: string;
}): Promise<{ id: string }> {
  const orderStored = input.manufacturingOrderBarcodeRaw.trim();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.machinePalletItem.findUnique({
      where: { id: input.itemId },
    });
    if (!existing) {
      throw new ApiError(404, 'パレットアイテムが見つかりません', undefined, 'PALLET_ITEM_NOT_FOUND');
    }
    const machineCd = normalizeCd(existing.resourceCd);
    const resolved = await resolveScheduleSnapshotForPalletItem(machineCd, input.manufacturingOrderBarcodeRaw);

    const updated = await tx.machinePalletItem.update({
      where: { id: existing.id },
      data: {
        fhincd: resolved.fhincd,
        fhinmei: resolved.fhinmei,
        fseiban: resolved.fseiban,
        machineName: resolved.machineName,
        csvDashboardRowId: resolved.csvDashboardRowId,
        scheduleSnapshot: resolved.scheduleSnapshot,
      },
    });

    await tx.machinePalletEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        actionType: 'REPLACE_ITEM',
        resourceCd: machineCd,
        palletNo: existing.palletNo,
        affectedItemId: updated.id,
        manufacturingOrderBarcodeRaw: orderStored,
        scheduleSnapshot: resolved.scheduleSnapshot as Prisma.InputJsonValue,
      },
    });

    return { id: updated.id };
  });
}

export async function commandDeletePalletItem(input: { clientDeviceId: string; itemId: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.machinePalletItem.findUnique({
      where: { id: input.itemId },
    });
    if (!existing) {
      throw new ApiError(404, 'パレットアイテムが見つかりません', undefined, 'PALLET_ITEM_NOT_FOUND');
    }
    const machineCd = normalizeCd(existing.resourceCd);

    await tx.machinePalletItem.delete({ where: { id: existing.id } });

    await tx.machinePalletEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        actionType: 'DELETE_ITEM',
        resourceCd: machineCd,
        palletNo: existing.palletNo,
        affectedItemId: existing.id,
      },
    });
  });
}

export async function commandClearPallet(input: {
  clientDeviceId: string;
  machineCd: string;
  palletNo: number;
}): Promise<void> {
  const machineCd = await assertMachineCdRegistered(input.machineCd);
  await assertPalletNoForMachine(machineCd, input.palletNo);

  await prisma.$transaction(async (tx) => {
    const items = await tx.machinePalletItem.findMany({
      where: { resourceCd: machineCd, palletNo: input.palletNo },
      select: { id: true },
    });

    await tx.machinePalletItem.deleteMany({
      where: { resourceCd: machineCd, palletNo: input.palletNo },
    });

    await tx.machinePalletEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        actionType: 'CLEAR_PALLET',
        resourceCd: machineCd,
        palletNo: input.palletNo,
        scheduleSnapshot: { clearedItemIds: items.map((i) => i.id) } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function commandUpsertPalletIllustration(input: {
  machineCd: string;
  buffer: Buffer;
  mimetype: string;
}): Promise<{ illustrationUrl: string }> {
  const machineCd = await assertMachineCdRegistered(input.machineCd);
  const { relativeUrl } = await PalletMachineIllustrationStorage.saveIllustration(input.buffer, input.mimetype);
  let previousRelativeUrl: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const prev = await tx.palletMachineIllustration.findUnique({
        where: { resourceCd: machineCd },
      });
      previousRelativeUrl = prev?.imageRelativeUrl ?? null;

      await tx.palletMachineIllustration.upsert({
        where: { resourceCd: machineCd },
        create: {
          resourceCd: machineCd,
          imageRelativeUrl: relativeUrl,
          palletCount: DEFAULT_MACHINE_PALLET_COUNT,
        },
        update: {
          imageRelativeUrl: relativeUrl,
        },
      });

      await tx.machinePalletEvent.create({
        data: {
          actionType: 'UPSERT_ILLUSTRATION',
          resourceCd: machineCd,
          illustrationRelativeUrl: relativeUrl,
        },
      });
    });
  } catch (error) {
    await PalletMachineIllustrationStorage.deleteIllustrationFile(relativeUrl);
    throw error;
  }

  if (previousRelativeUrl) {
    await PalletMachineIllustrationStorage.deleteIllustrationFile(previousRelativeUrl);
  }

  return { illustrationUrl: relativeUrl };
}

export async function commandDeletePalletIllustration(input: { machineCd: string }): Promise<void> {
  const machineCd = await assertMachineCdRegistered(input.machineCd);
  let previousRelativeUrl: string | null = null;

  await prisma.$transaction(async (tx) => {
    const prev = await tx.palletMachineIllustration.findUnique({
      where: { resourceCd: machineCd },
    });
    if (!prev) {
      return;
    }
    previousRelativeUrl = prev.imageRelativeUrl;

    await tx.palletMachineIllustration.update({
      where: { resourceCd: machineCd },
      data: { imageRelativeUrl: null },
    });

    await tx.machinePalletEvent.create({
      data: {
        actionType: 'DELETE_ILLUSTRATION',
        resourceCd: machineCd,
        illustrationRelativeUrl: previousRelativeUrl,
      },
    });
  });

  if (previousRelativeUrl) {
    await PalletMachineIllustrationStorage.deleteIllustrationFile(previousRelativeUrl);
  }
}

/**
 * 加工機ごとのパレット数を upsert する。台数未設定行は `imageRelativeUrl: null` で作れる。
 * 高い方のパレット番号に在庫がある場合は台数の縮小を拒否する。
 */
export async function commandUpdatePalletMachinePalletCount(input: {
  machineCd: string;
  palletCount: number;
}): Promise<void> {
  const machineCd = await assertMachineCdRegistered(input.machineCd);
  if (!Number.isInteger(input.palletCount) || input.palletCount < 1 || input.palletCount > MAX_MACHINE_PALLET_COUNT) {
    throw new ApiError(
      400,
      `パレット数は 1〜${MAX_MACHINE_PALLET_COUNT} を指定してください`,
      undefined,
      'PALLET_COUNT_INVALID'
    );
  }

  const over = await prisma.machinePalletItem.findFirst({
    where: { resourceCd: machineCd, palletNo: { gt: input.palletCount } },
    orderBy: { palletNo: 'desc' },
    select: { palletNo: true },
  });
  if (over) {
    throw new ApiError(
      400,
      `パレット${over.palletNo}以降に登録があるため、台数を${String(input.palletCount)}未満にできません`,
      undefined,
      'PALLET_COUNT_CONFLICTS_WITH_ITEMS'
    );
  }

  await prisma.palletMachineIllustration.upsert({
    where: { resourceCd: machineCd },
    create: { resourceCd: machineCd, palletCount: input.palletCount, imageRelativeUrl: null },
    update: { palletCount: input.palletCount },
  });
}
