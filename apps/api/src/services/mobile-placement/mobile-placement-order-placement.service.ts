import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { listScheduleRowsByProductNo } from '../production-schedule/production-schedule-lookup.service.js';
import { findProductionSchedulePlacementSnapshot } from '../production-schedule/production-schedule-snapshot.service.js';
import { findPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { invalidateMobileDataVersions } from './mobile-local-data.service.js';
import { normalizeSlipToken } from './mobile-placement-slip-match.js';

export type RegisterOrderPlacementInput = {
  clientDeviceId: string;
  shelfCodeRaw: string;
  manufacturingOrderBarcodeRaw: string;
  slipKind?: 'manufacturing_order' | 'purchase_order';
  clientRecordId?: string;
  placedAt?: string;
  branchNo?: number;
};

async function findReplay(clientRecordId: string, db: Prisma.TransactionClient = prisma) {
  const event = await db.orderPlacementEvent.findUnique({ where: { clientRecordId } });
  if (!event) return null;
  const state = await db.orderPlacementBranchState.findUnique({
    where: { manufacturingOrderBarcodeRaw_branchNo: {
      manufacturingOrderBarcodeRaw: event.manufacturingOrderBarcodeRaw, branchNo: event.branchNo
    } }
  });
  // 初回に古い記録と判定された再送は、同じく stale と今の枝を返す（初回の応答を再現する）。
  const branchFilter = event.branchNo === 0 ? { gt: 0 } : 0;
  const newerAtFirst = await db.orderPlacementEvent.findFirst({ where: {
    manufacturingOrderBarcodeRaw: event.manufacturingOrderBarcodeRaw, id: { not: event.id },
    createdAt: { lt: event.createdAt }, placedAt: { gt: event.placedAt },
    OR: [{ branchNo: event.branchNo }, { branchNo: branchFilter }]
  }, orderBy: { placedAt: 'desc' } });
  const current = newerAtFirst && (state ?? await db.orderPlacementBranchState.findFirst({
    where: { manufacturingOrderBarcodeRaw: event.manufacturingOrderBarcodeRaw, branchNo: newerAtFirst.branchNo }
  }));
  if (current) {
    return { event, branchState: current, resolvedRowId: current.csvDashboardRowId, action: 'stale' as const };
  }
  // 再送までの間に枝が削除されていても、登録済みとして応答しスマホ側の再送を止める。
  const branchState = state ?? { id: '', branchNo: event.branchNo, shelfCodeRaw: event.shelfCodeRaw };
  return { event, branchState, resolvedRowId: event.csvDashboardRowId, action: event.actionType === 'MOVE_BRANCH' ? 'moved' as const : 'created' as const };
}

/**
 * 指定されたスタンプの現在棚を作成・移動する。番号省略時は従来の自動採番を維持する。
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

  async function resolveSnapshot() {
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
    return { csvDashboardRowId, scheduleSnapshot };
  }
  const initialState = input.branchNo === undefined ? null : await prisma.orderPlacementBranchState.findFirst({
    where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored, branchNo: input.branchNo }
  });
  const initialSnapshot = initialState ? null : await resolveSnapshot();

  const now = new Date();
  const clientTime = input.placedAt ? new Date(input.placedAt) : now;
  const age = now.getTime() - clientTime.getTime();
  const placedAt = Number.isFinite(age) && age >= -5 * 60_000 && age <= 7 * 24 * 60 * 60_000 ? clientTime : now;

  const shelfStored = input.shelfCodeRaw.trim();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize stamp exclusivity and numbering for this order, including legacy callers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order-placement:${manufacturingOrderStored}`}, 0))`;
      if (input.clientRecordId) {
        const replay = await findReplay(input.clientRecordId, tx);
        if (replay) return replay;
      }
      const states = await tx.orderPlacementBranchState.findMany({
        where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored }
      });
      const conflicts = states.filter((state) => input.branchNo === 0 ? state.branchNo > 0 : state.branchNo === 0);
      const conflictEvents = await Promise.all(conflicts.map(async (state) => ({
        state,
        placedAt: state.lastEventId
          ? (await tx.orderPlacementEvent.findUniqueOrThrow({ where: { id: state.lastEventId } })).placedAt
          : state.updatedAt
      })));
      const newestConflict = conflictEvents.sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())[0];
      const staleConflict = newestConflict && placedAt < newestConflict.placedAt;
      if (input.branchNo !== undefined) {
        const state = states.find((item) => item.branchNo === input.branchNo);
        if (state) {
          const lastEvent = state.lastEventId
            ? await tx.orderPlacementEvent.findUniqueOrThrow({ where: { id: state.lastEventId } })
            : null;
          const stale = placedAt < (lastEvent?.placedAt ?? state.updatedAt);
          if (!stale && state.shelfCodeRaw === shelfStored && !input.clientRecordId) {
            const event = lastEvent
              ?? { id: '', clientDeviceId: input.clientDeviceId, shelfCodeRaw: state.shelfCodeRaw,
                manufacturingOrderBarcodeRaw: state.manufacturingOrderBarcodeRaw,
                csvDashboardRowId: state.csvDashboardRowId, branchNo: state.branchNo,
                actionType: 'MOVE_BRANCH', placedAt: state.updatedAt };
            return { event, branchState: state, resolvedRowId: state.csvDashboardRowId, action: 'unchanged' as const };
          }
          const event = await tx.orderPlacementEvent.create({ data: {
            clientDeviceId: input.clientDeviceId, clientRecordId: input.clientRecordId, placedAt,
            shelfCodeRaw: shelfStored, manufacturingOrderBarcodeRaw: manufacturingOrderStored,
            branchNo: state.branchNo, slipKind: state.slipKind,
            csvDashboardRowId: state.csvDashboardRowId,
            scheduleSnapshot: (state.scheduleSnapshot ?? {}) as Prisma.InputJsonValue, actionType: 'MOVE_BRANCH'
          } });
          if (stale) {
            return { event, branchState: state, resolvedRowId: state.csvDashboardRowId, action: 'stale' as const };
          }
          const branchState = await tx.orderPlacementBranchState.update({
            where: { id: state.id }, data: { shelfCodeRaw: shelfStored, lastEventId: event.id }
          });
          return { event, branchState, resolvedRowId: state.csvDashboardRowId,
            action: state.shelfCodeRaw === shelfStored ? 'unchanged' as const : 'moved' as const };
        }
      }
      const { csvDashboardRowId, scheduleSnapshot } = initialSnapshot ?? await resolveSnapshot();
      const scheduleJson = scheduleSnapshot as Prisma.InputJsonValue;
      let nextBranch = input.branchNo;
      if (nextBranch === undefined) {
        const maxBranch = await tx.orderPlacementBranchState.aggregate({
          where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored },
          _max: { branchNo: true }
        });
        const maxEventBranch = await tx.orderPlacementEvent.aggregate({
          where: { manufacturingOrderBarcodeRaw: manufacturingOrderStored },
          _max: { branchNo: true }
        });
        nextBranch = Math.max(maxBranch._max.branchNo ?? 0, maxEventBranch._max.branchNo ?? 0) + 1;
      }

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

      if (staleConflict) {
        return { event: createdEv, branchState: newestConflict.state,
          resolvedRowId: newestConflict.state.csvDashboardRowId, action: 'stale' as const };
      }
      if (conflicts.length > 0) {
        await tx.orderPlacementBranchState.deleteMany({ where: { id: { in: conflicts.map((state) => state.id) } } });
      }

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

      return { event: createdEv, branchState: createdState, resolvedRowId: csvDashboardRowId, action: 'created' as const };
    });
    // Phones refresh placements right after a send: a cached pre-write version would hide the new row.
    invalidateMobileDataVersions();
    return result;

  } catch (error) {
    if (input.clientRecordId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await findReplay(input.clientRecordId);
      if (replay) return replay;
    }
    throw error;
  }
}
