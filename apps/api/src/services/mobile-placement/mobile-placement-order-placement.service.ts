import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { listScheduleRowsByProductNo } from '../part-measurement/part-measurement-schedule-lookup.service.js';
import { normalizeSlipToken } from './mobile-placement-slip-match.js';

export type RegisterOrderPlacementInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
  manufacturingOrderBarcodeRaw: string;
};

/**
 * 製造order番号で生産スケジュール行を特定し、部品配膳イベントのみ保存する（Item は更新しない）。
 */
export async function registerOrderPlacement(input: RegisterOrderPlacementInput) {
  const shelf = normalizeSlipToken(input.shelfCodeRaw);
  const orderScan = normalizeSlipToken(input.manufacturingOrderBarcodeRaw);

  if (shelf.length === 0) {
    throw new ApiError(400, '棚番が空です');
  }
  if (orderScan.length === 0) {
    throw new ApiError(400, '製造order番号のスキャンが空です');
  }

  const device = await prisma.clientDevice.findUnique({
    where: { id: input.clientDeviceId }
  });
  if (!device) {
    throw new ApiError(400, 'クライアント端末が不正です');
  }

  const candidates = await listScheduleRowsByProductNo(orderScan);
  if (candidates.length === 0) {
    throw new ApiError(
      404,
      '製造order番号に一致するスケジュール行がありません',
      undefined,
      'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND'
    );
  }

  const primary = candidates[0];
  if (!primary) {
    throw new ApiError(
      404,
      '製造order番号に一致するスケジュール行がありません',
      undefined,
      'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND'
    );
  }

  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: primary.rowId },
    select: { id: true, rowData: true }
  });
  if (!row) {
    throw new ApiError(
      404,
      'スケジュール行の取得に失敗しました',
      undefined,
      'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND'
    );
  }

  const rd = (row.rowData ?? {}) as Record<string, unknown>;
  const scheduleSnapshot: Record<string, unknown> = {
    ProductNo: rd.ProductNo ?? null,
    FSEIBAN: rd.FSEIBAN ?? null,
    FHINCD: rd.FHINCD ?? null,
    FHINMEI: rd.FHINMEI ?? null
  };

  const ev = await prisma.orderPlacementEvent.create({
    data: {
      clientDeviceId: input.clientDeviceId,
      shelfCodeRaw: input.shelfCodeRaw.trim(),
      manufacturingOrderBarcodeRaw: input.manufacturingOrderBarcodeRaw.trim(),
      csvDashboardRowId: row.id,
      scheduleSnapshot: scheduleSnapshot as Prisma.InputJsonValue
    }
  });

  return {
    event: ev,
    resolvedRowId: row.id
  };
}
