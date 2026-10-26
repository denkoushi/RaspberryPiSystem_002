import { Prisma } from '@prisma/client';
import { composeArea } from '@raspi-system/shelf-layout-core';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { isSerializationFailure, listShelfLandmarks, requireShelfMachines } from './shelf-landmark.service.js';
import { parseStructuredShelfCode, type RegisteredShelfEntry } from './mobile-placement-registered-shelves.service.js';

export async function deleteMobilePlacementShelf(shelfCodeRaw: string): Promise<{ shelfCodeRaw: string }> {
  return prisma.$transaction(async (tx) => {
    shelfCodeRaw = shelfCodeRaw.trim();
    if (!shelfCodeRaw) {
      throw new ApiError(400, '棚番が空です', undefined, 'MOBILE_PLACEMENT_SHELF_EMPTY');
    }
    const shelf = await tx.mobilePlacementShelf.findUnique({ where: { shelfCodeRaw }, select: { id: true } });
    if (!shelf) {
      throw new ApiError(404, '棚が見つかりません', undefined, 'SHELF_DELETE_NOT_FOUND');
    }
    const branchCount = await tx.orderPlacementBranchState.count({ where: { shelfCodeRaw } });
    const haizenCount = await tx.haizenCurrentPlacement.count({ where: { shelfCodeRaw } });
    const n = branchCount + haizenCount;
    if (n > 0) {
      throw new ApiError(409, `品物が ${n}件 置いてあるので消せません。先に「棚を動かす」で移してください`, undefined, 'SHELF_DELETE_HAS_ITEMS');
    }
    await tx.clientDevice.updateMany({
      where: { haizenPresetShelfCodeRaw: shelfCodeRaw },
      data: { haizenPresetShelfCodeRaw: null }
    });
    await tx.mobilePlacementLayoutEntity.updateMany({
      where: { shelfId: shelf.id },
      data: { entityKind: 'UNUSED', shelfId: null }
    });
    await tx.mobilePlacementShelf.delete({ where: { id: shelf.id } });
    return { shelfCodeRaw };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * 棚マスタ一覧（トップの「登録済み棚番」候補の正本）。
 * 認可はルート側の `requireClientDevice` に委ねる。
 */
export async function listRegisteredShelvesFromShelfMaster(): Promise<RegisteredShelfEntry[]> {
  const rows = await prisma.mobilePlacementShelf.findMany({
    select: {
      shelfCodeRaw: true,
      displayLabel: true,
      tier: true,
      macroZoneId: true,
      photo: { select: { updatedAt: true } }
    },
    orderBy: { shelfCodeRaw: 'asc' }
  });

  const landmarks = await listShelfLandmarks();
  // The underlying machine query is cached. A failure must not hide existing shelves.
  const machines = rows.length ? await requireShelfMachines().catch(() => []) : [];
  const knownNames = new Set([...landmarks, ...machines]);
  return rows.map((r) => {
    const parsed = parseStructuredShelfCode(r.shelfCodeRaw, knownNames);
    return {
      shelfCodeRaw: r.shelfCodeRaw,
      displayLabel: r.displayLabel,
      photoUpdatedAt: r.photo?.updatedAt.toISOString() ?? null,
      macroZoneId: r.macroZoneId,
      ...(r.tier != null ? { tier: r.tier } : parsed.tier != null ? { tier: parsed.tier } : {}),
      ...parsed
    };
  });
}

export type RegisterMobilePlacementShelfInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
  displayLabel?: string | null;
};

/**
 * 棚マスタへ新規登録（`+` 画面）。`目安 方角` または `目安`。
 */
export async function registerMobilePlacementShelf(
  input: RegisterMobilePlacementShelfInput
): Promise<{ shelf: RegisteredShelfEntry }> {
  let raw = input.shelfCodeRaw.trim();
  if (raw.length === 0) {
    throw new ApiError(400, '棚番が空です', undefined, 'MOBILE_PLACEMENT_SHELF_EMPTY');
  }

  const machines = await requireShelfMachines();
  let parsed: Omit<RegisteredShelfEntry, 'shelfCodeRaw'>;
  try {
    parsed = await prisma.$transaction(async (tx) => {
      const landmarks = await tx.mobilePlacementShelfLandmark.findMany({ select: { name: true } });
      const knownNames = new Set([...machines, ...landmarks.map((landmark) => landmark.name)]);
      const result = parseStructuredShelfCode(raw, knownNames);
      if (!result.machineName || !knownNames.has(result.machineName)) {
        throw new ApiError(400, '登録済みの目安と方角を選んでください', undefined, 'MOBILE_PLACEMENT_SHELF_NOT_STRUCTURED');
      }
      raw = result.direction ? composeArea(result.machineName, result.direction) : result.machineName;
      await tx.mobilePlacementShelf.create({
        data: {
          shelfCodeRaw: raw,
          displayLabel: input.displayLabel?.trim() || null,
          createdByClientDeviceId: input.clientDeviceId
        }
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError(409, 'この目安・方角の棚はもうあります', undefined, 'MOBILE_PLACEMENT_SHELF_DUPLICATE');
    }
    if (isSerializationFailure(e)) {
      throw new ApiError(409, '同時に操作されました。もう一度お試しください');
    }
    throw e;
  }

  return {
    shelf: {
      shelfCodeRaw: raw,
      displayLabel: input.displayLabel?.trim() || null,
      photoUpdatedAt: null,
      ...parsed
    }
  };
}
