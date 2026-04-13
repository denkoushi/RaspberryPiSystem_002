import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { parseStructuredShelfCode, type RegisteredShelfEntry } from './mobile-placement-registered-shelves.service.js';

/**
 * 棚マスタ一覧（トップの「登録済み棚番」候補の正本）。
 * 認可はルート側の `requireClientDevice` に委ねる。
 */
export async function listRegisteredShelvesFromShelfMaster(): Promise<RegisteredShelfEntry[]> {
  const rows = await prisma.mobilePlacementShelf.findMany({
    select: { shelfCodeRaw: true },
    orderBy: { shelfCodeRaw: 'asc' }
  });

  return rows.map((r) => {
    const parsed = parseStructuredShelfCode(r.shelfCodeRaw);
    return {
      shelfCodeRaw: r.shelfCodeRaw,
      ...parsed
    };
  });
}

export type RegisterMobilePlacementShelfInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
};

/**
 * 棚マスタへ新規登録（`+` 画面）。`西-北-01` 形式のみ。
 */
export async function registerMobilePlacementShelf(
  input: RegisterMobilePlacementShelfInput
): Promise<{ shelf: RegisteredShelfEntry }> {
  const raw = input.shelfCodeRaw.trim();
  if (raw.length === 0) {
    throw new ApiError(400, '棚番が空です', undefined, 'MOBILE_PLACEMENT_SHELF_EMPTY');
  }

  const parsed = parseStructuredShelfCode(raw);
  if (!parsed.isStructured) {
    throw new ApiError(
      400,
      '棚番は 西-北-01 の形式（エリア・列・2桁番号）で登録してください',
      undefined,
      'MOBILE_PLACEMENT_SHELF_NOT_STRUCTURED'
    );
  }

  try {
    await prisma.mobilePlacementShelf.create({
      data: {
        shelfCodeRaw: raw,
        createdByClientDeviceId: input.clientDeviceId
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError(
        409,
        'この棚番は既に登録されています',
        undefined,
        'MOBILE_PLACEMENT_SHELF_DUPLICATE'
      );
    }
    throw e;
  }

  return {
    shelf: {
      shelfCodeRaw: raw,
      ...parsed
    }
  };
}
