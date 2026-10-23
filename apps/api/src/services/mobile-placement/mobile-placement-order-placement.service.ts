import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { listScheduleRowsByProductNo } from '../production-schedule/production-schedule-lookup.service.js';
import { findProductionSchedulePlacementSnapshot } from '../production-schedule/production-schedule-snapshot.service.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { normalizeSlipToken } from './mobile-placement-slip-match.js';

export type RegisterOrderPlacementInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
  manufacturingOrderBarcodeRaw: string;
  slipKind?: 'manufacturing_order' | 'purchase_order';
  clientRecordId?: string;
  placedAt?: string;
};

async function findReplay(clientRecordId: string) {
  const event = await prisma.orderPlacementEvent.findUnique({ where: { clientRecordId } });
  if (!event) return null;
  const state = await prisma.orderPlacementBranchState.findUnique({
    where: { manufacturingOrderBarcodeRaw_branchNo: {
      manufacturingOrderBarcodeRaw: event.manufacturingOrderBarcodeRaw, branchNo: event.branchNo
    } }
  });
  // 再送までの間に枝が削除されていても、登録済みとして応答しスマホ側の再送を止める。
  const branchState = state ?? { id: '', branchNo: event.branchNo, shelfCodeRaw: event.shelfCodeRaw };
  return { event, branchState, resolvedRowId: event.csvDashboardRowId };
}

/**
 * 製造order番号で生産スケジュール行を特定し、**新しい分配枝**を追加する（Item は更新しない）。
 * 既存枝の棚変更は `moveOrderPlacementBranch` を使う。
 */
export async function registerOrderPlacement(input: RegisterOrderPlacementInput) {
  if (input.clientRecordId) {
    const replay = await findReplay(input.clientRecordId);
    if (replay) return replay;
  }
  const slipKind = input.slipKind ?? 'manufacturing_order';
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

  let csvDashboardRowId: string | null = null;
  let scheduleSnapshot: Record<string, unknown>;
  if (slipKind === 'purchase_order') {
    if (!/^\d{10}$/.test(manufacturingOrderStored)) {
      throw new ApiError(400, '注文番号は10桁の数字で読んでください');
    }
    const rows = await findPurchaseOrderLookupRows(manufacturingOrderStored);
    if (!rows.length) {
      throw new ApiError(404, 'この注文番号は購買データにありません', undefined, 'ORDER_PLACEMENT_PURCHASE_ORDER_NOT_FOUND');
    }
    if (new Set(rows.map((row) => row.seiban.trim()).filter(Boolean)).size > 1) {
      throw new ApiError(409, 'この注文番号は製番が複数あります', undefined, 'ORDER_PLACEMENT_PURCHASE_ORDER_AMBIGUOUS');
    }
    const first = rows[0]!;
    scheduleSnapshot = {
      FSEIBAN: first.seiban, FHINCD: first.purchasePartCodeRaw,
      FHINMEI: first.purchasePartName, PurchaseOrderNo: manufacturingOrderStored
    };
  } else {
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

    scheduleSnapshot = {
      ProductNo: snapshot.manufacturingOrderNo,
      FSEIBAN: snapshot.seiban,
      FHINCD: snapshot.partCode,
      FHINMEI: snapshot.partName
    };
    csvDashboardRowId = snapshot.rowId;
  }

  const now = new Date();
  const clientTime = input.placedAt ? new Date(input.placedAt) : now;
  const age = now.getTime() - clientTime.getTime();
  const placedAt = Number.isFinite(age) && age >= -5 * 60_000 && age <= 7 * 24 * 60 * 60_000 ? clientTime : now;

  const scheduleJson = scheduleSnapshot as Prisma.InputJsonValue;
  const shelfStored = input.shelfCodeRaw.trim();

  try {
    const { event: ev, branchState } = await prisma.$transaction(async (tx) => {
      const maxBranch = await tx.orderPlacementBranchState.aggregate({
        where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored },
        _max: { branchNo: true }
      });
      const maxEventBranch = await tx.orderPlacementEvent.aggregate({
        where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored },
        _max: { branchNo: true }
      });
      const nextBranch = Math.max(maxBranch._max.branchNo ?? 0, maxEventBranch._max.branchNo ?? 0) + 1;

      const createdEv = await tx.orderPlacementEvent.create({
        data: {
          clientDeviceId: input.clientDeviceId,
          clientRecordId: input.clientRecordId,
          slipKind,
          placedAt,
          shelfCodeRaw: shelfStored,
          manufacturingOrderBarcodeRaw: manufacturingOrderStored,
          csvDashboardRowId,
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
          csvDashboardRowId,
          scheduleSnapshot: scheduleJson,
          lastEventId: createdEv.id,
          slipKind
        }
      });

      return { event: createdEv, branchState: createdState };
    });

    return {
      event: ev,
      resolvedRowId: csvDashboardRowId,
      branchState
    };
  } catch (error) {
    if (input.clientRecordId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await findReplay(input.clientRecordId);
      if (replay) return replay;
    }
    throw error;
  }
}
