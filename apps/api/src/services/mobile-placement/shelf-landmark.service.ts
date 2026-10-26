import { Prisma } from '@prisma/client';
import { SHELF_DIRECTIONS, composeArea } from '@raspi-system/shelf-layout-core';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { listMachinesForShelfRegistration } from './machine-master-query.service.js';
import { parseStructuredShelfCode } from './mobile-placement-registered-shelves.service.js';

export function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export async function requireShelfMachines(): Promise<string[]> {
  try {
    return (await listMachinesForShelfRegistration()).machines;
  } catch {
    throw new ApiError(503, '加工機一覧を取得できませんでした。再試行してください', undefined, 'SHELF_MACHINES_UNAVAILABLE');
  }
}

export async function listShelfLandmarks(): Promise<string[]> {
  const rows = await prisma.mobilePlacementShelfLandmark.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  return rows.map((row) => row.name);
}

export async function addShelfLandmark(nameRaw: string, clientDeviceId: string): Promise<{ name: string }> {
  const name = nameRaw.trim();
  if (!name || name.length > 30) {
    throw new ApiError(400, '目安は1〜30文字で入力してください');
  }
  // A landmark must not itself read as a shelf name ("X 北" or the old "西-北-02").
  if (parseStructuredShelfCode(name).isStructured) {
    throw new ApiError(400, '方角や棚番の形の名前は使えません');
  }
  if ((await requireShelfMachines()).includes(name)) {
    throw new ApiError(409, '加工機と同じ名前は使えません');
  }
  try {
    await prisma.mobilePlacementShelfLandmark.create({ data: { name, createdByClientDeviceId: clientDeviceId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'この目安はもうあります');
    }
    throw error;
  }
  return { name };
}

export async function deleteShelfLandmark(name: string): Promise<{ name: string }> {
  return prisma.$transaction(async (tx) => {
    const used = await tx.mobilePlacementShelf.count({
      where: { shelfCodeRaw: { in: [name, ...SHELF_DIRECTIONS.map((direction) => composeArea(name, direction))] } }
    });
    if (used > 0) throw new ApiError(409, '棚が使っている目安は消せません');
    const deleted = await tx.mobilePlacementShelfLandmark.deleteMany({ where: { name } });
    if (!deleted.count) throw new ApiError(404, '目安が見つかりません');
    return { name };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
    if (isSerializationFailure(error)) throw new ApiError(409, '同時に操作されました。もう一度お試しください');
    throw error;
  });
}
