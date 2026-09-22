import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { listScheduleRowsByProductNo } from '../production-schedule/production-schedule-lookup.service.js';
import { findProductionSchedulePlacementSnapshot } from '../production-schedule/production-schedule-snapshot.service.js';
import { normalizeSlipToken } from './mobile-placement-slip-match.js';

export type RegisterOrderPlacementInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
  manufacturingOrderBarcodeRaw: string;
};

/**
 * 製造order番号で生産スケジュール行を特定し、**新しい分配枝**を追加する（Item は更新しない）。
 * 既存枝の棚変更は `moveOrderPlacementBranch` を使う。
 */
export async function registerOrderPlacement(input: RegisterOrderPlacementInput) {
  const shelf = normalizeSlipToken(input.shelfCodeRaw);
  const orderScan = normalizeSlipToken(input.manufacturingOrderBarcodeRaw);
  /** DB 上の製造orderキー（従来イベントと同一の trim のみ） */
  const manufacturingOrderStored = input.manufacturingOrderBarcodeRaw.trim();

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

  const snapshot = await findProductionSchedulePlacementSnapshot(primary.rowId);
  if (!snapshot) {
    throw new ApiError(
      404,
      'スケジュール行の取得に失敗しました',
      undefined,
      'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND'
    );
  }

  const scheduleSnapshot: Record<string, unknown> = {
    ProductNo: snapshot.manufacturingOrderNo,
    FSEIBAN: snapshot.seiban,
    FHINCD: snapshot.partCode,
    FHINMEI: snapshot.partName
  };

  const scheduleJson = scheduleSnapshot as Prisma.InputJsonValue;
  const shelfStored = input.shelfCodeRaw.trim();

  const { event: ev, branchState } = await prisma.$transaction(async (tx) => {
    const maxBranch = await tx.orderPlacementBranchState.aggregate({
      where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored },
      _max: { branchNo: true }
    });
    const nextBranch = (maxBranch._max.branchNo ?? 0) + 1;

    const createdEv = await tx.orderPlacementEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        shelfCodeRaw: shelfStored,
        manufacturingOrderBarcodeRaw: manufacturingOrderStored,
        csvDashboardRowId: snapshot.rowId,
        scheduleSnapshot: scheduleJson,
        branchNo: nextBranch,
        actionType: 'CREATE_BRANCH'
      }
    });

    const createdState = await tx.orderPlacementBranchState.create({
      data: {
        manufacturingOrderBarcodeRaw: manufacturingOrderStored,
        branchNo: nextBranch,
        shelfCodeRaw: shelfStored,
        csvDashboardRowId: snapshot.rowId,
        scheduleSnapshot: scheduleJson,
        lastEventId: createdEv.id
      }
    });

    return { event: createdEv, branchState: createdState };
  });

  return {
    event: ev,
    resolvedRowId: snapshot.rowId,
    branchState
  };
}
