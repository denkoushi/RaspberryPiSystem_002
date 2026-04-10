import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';

export type MobilePlacementRegisterInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
  itemBarcodeRaw: string;
  csvDashboardRowId?: string | null;
};

function normalizePlacementToken(value: string): string {
  return value.trim().replace(/\u3000/g, ' ');
}

/** バーコード文字列を Item.itemCode として解決（大文字小文字無視） */
export async function resolveItemByBarcode(barcode: string): Promise<{
  item: { id: string; itemCode: string; name: string; storageLocation: string | null } | null;
  matchKind: 'itemCode' | 'none';
}> {
  const raw = normalizePlacementToken(barcode);
  if (raw.length === 0) {
    return { item: null, matchKind: 'none' };
  }

  const item = await prisma.item.findFirst({
    where: { itemCode: { equals: raw, mode: 'insensitive' } },
    select: { id: true, itemCode: true, name: true, storageLocation: true }
  });

  if (!item) {
    return { item: null, matchKind: 'none' };
  }
  return { item, matchKind: 'itemCode' };
}

async function assertBarcodeMatchesScheduleRow(params: {
  csvDashboardRowId: string;
  itemBarcodeRaw: string;
  item: { itemCode: string } | null;
}): Promise<{ rowData: unknown }> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: {
      id: params.csvDashboardRowId,
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
    },
    select: { rowData: true }
  });
  if (!row) {
    throw new ApiError(404, '指定のスケジュール行が見つかりません');
  }

  const rd = (row.rowData ?? {}) as Record<string, unknown>;
  const productNo = typeof rd.ProductNo === 'string' ? rd.ProductNo.trim() : '';
  const fseiban = typeof rd.FSEIBAN === 'string' ? rd.FSEIBAN.trim() : '';
  const fhincd = typeof rd.FHINCD === 'string' ? rd.FHINCD.trim() : '';

  const scan = normalizePlacementToken(params.itemBarcodeRaw);
  const scanUpper = scan.toUpperCase();

  const matchesField =
    (productNo.length > 0 && scanUpper === productNo.toUpperCase()) ||
    (fseiban.length > 0 && scanUpper === fseiban.toUpperCase()) ||
    (fhincd.length > 0 && scanUpper === fhincd.toUpperCase());

  const itemCodeUpper = params.item?.itemCode.trim().toUpperCase() ?? '';
  const matchesItem =
    itemCodeUpper.length > 0 &&
    ((productNo.length > 0 && itemCodeUpper === productNo.toUpperCase()) ||
      (fseiban.length > 0 && itemCodeUpper === fseiban.toUpperCase()) ||
      (fhincd.length > 0 && itemCodeUpper === fhincd.toUpperCase()));

  if (!matchesField && !matchesItem) {
    throw new ApiError(
      400,
      'スキャン値が選択したスケジュール行（製番・品番・品目コード）または工具コードと一致しません',
      undefined,
      'MOBILE_PLACEMENT_SCHEDULE_MISMATCH'
    );
  }

  return { rowData: row.rowData };
}

export async function registerPlacement(input: MobilePlacementRegisterInput) {
  const shelf = normalizePlacementToken(input.shelfCodeRaw);
  const itemScan = normalizePlacementToken(input.itemBarcodeRaw);

  if (shelf.length === 0) {
    throw new ApiError(400, '棚番（スキャン値）が空です');
  }
  if (itemScan.length === 0) {
    throw new ApiError(400, 'アイテムのバーコードが空です');
  }

  const device = await prisma.clientDevice.findUnique({
    where: { id: input.clientDeviceId }
  });
  if (!device) {
    throw new ApiError(400, 'クライアント端末が不正です');
  }

  const { item, matchKind } = await resolveItemByBarcode(itemScan);
  if (!item) {
    throw new ApiError(
      404,
      '工具マスタに一致する itemCode がありません。現場バーコードの意味を KB-339 で確定し、Item.itemCode を揃えてください',
      undefined,
      'MOBILE_PLACEMENT_ITEM_NOT_FOUND'
    );
  }

  let scheduleSnapshot: Record<string, unknown> | undefined;
  if (input.csvDashboardRowId && input.csvDashboardRowId.trim().length > 0) {
    const { rowData } = await assertBarcodeMatchesScheduleRow({
      csvDashboardRowId: input.csvDashboardRowId.trim(),
      itemBarcodeRaw: itemScan,
      item: { itemCode: item.itemCode }
    });
    const rd = (rowData ?? {}) as Record<string, unknown>;
    scheduleSnapshot = {
      ProductNo: rd.ProductNo ?? null,
      FSEIBAN: rd.FSEIBAN ?? null,
      FHINCD: rd.FHINCD ?? null,
      FHINMEI: rd.FHINMEI ?? null
    };
  }

  const previousStorageLocation = item.storageLocation;

  const updated = await prisma.$transaction(async (tx) => {
    const ev = await tx.mobilePlacementEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        shelfCodeRaw: input.shelfCodeRaw.trim(),
        itemBarcodeRaw: input.itemBarcodeRaw.trim(),
        itemId: item.id,
        csvDashboardRowId: input.csvDashboardRowId?.trim() || null,
        ...(scheduleSnapshot !== undefined
          ? { scheduleSnapshot: scheduleSnapshot as Prisma.InputJsonValue }
          : {}),
        previousStorageLocation,
        newStorageLocation: shelf
      }
    });

    const it = await tx.item.update({
      where: { id: item.id },
      data: { storageLocation: shelf },
      select: { id: true, itemCode: true, name: true, storageLocation: true }
    });

    return { event: ev, item: it };
  });

  return {
    ...updated,
    resolveMatchKind: matchKind
  };
}
