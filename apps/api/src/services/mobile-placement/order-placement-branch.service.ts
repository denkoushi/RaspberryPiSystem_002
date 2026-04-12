import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export type OrderPlacementBranchListItem = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  branchNo: number;
  shelfCodeRaw: string;
  csvDashboardRowId: string | null;
  updatedAt: Date;
};

/**
 * 製造order（スキャン値の trim 一致）に紐づく分配枝の現在棚一覧。
 */
export async function listOrderPlacementBranches(
  manufacturingOrderBarcodeRaw: string
): Promise<OrderPlacementBranchListItem[]> {
  const key = manufacturingOrderBarcodeRaw.trim();
  if (key.length === 0) {
    throw new ApiError(400, '製造order番号が空です');
  }
  const rows = await prisma.orderPlacementBranchState.findMany({
    where: { manufacturingOrderBarcodeRaw: key },
    orderBy: { branchNo: 'asc' }
  });
  return rows.map((r) => ({
    id: r.id,
    manufacturingOrderBarcodeRaw: r.manufacturingOrderBarcodeRaw,
    branchNo: r.branchNo,
    shelfCodeRaw: r.shelfCodeRaw,
    csvDashboardRowId: r.csvDashboardRowId,
    updatedAt: r.updatedAt
  }));
}

export type MoveOrderPlacementBranchInput = {
  clientDeviceId: string;
  branchStateId: string;
  shelfCodeRaw: string;
};

/**
 * 既存分配枝の棚を更新する（履歴に MOVE_BRANCH を追記し、現在棚を更新）。
 */
export async function moveOrderPlacementBranch(input: MoveOrderPlacementBranchInput) {
  const shelf = input.shelfCodeRaw.trim();
  if (shelf.length === 0) {
    throw new ApiError(400, '棚番が空です');
  }

  const device = await prisma.clientDevice.findUnique({
    where: { id: input.clientDeviceId }
  });
  if (!device) {
    throw new ApiError(400, 'クライアント端末が不正です');
  }

  const state = await prisma.orderPlacementBranchState.findUnique({
    where: { id: input.branchStateId }
  });
  if (!state) {
    throw new ApiError(
      404,
      '分配枝が見つかりません',
      undefined,
      'ORDER_PLACEMENT_BRANCH_NOT_FOUND'
    );
  }

  const scheduleSnapshot = (state.scheduleSnapshot ?? {}) as Prisma.InputJsonValue;

  const { event: ev, branchState: updated } = await prisma.$transaction(async (tx) => {
    const createdEv = await tx.orderPlacementEvent.create({
      data: {
        clientDeviceId: input.clientDeviceId,
        shelfCodeRaw: shelf,
        manufacturingOrderBarcodeRaw: state.manufacturingOrderBarcodeRaw,
        csvDashboardRowId: state.csvDashboardRowId,
        scheduleSnapshot,
        branchNo: state.branchNo,
        actionType: 'MOVE_BRANCH'
      }
    });

    const next = await tx.orderPlacementBranchState.update({
      where: { id: state.id },
      data: {
        shelfCodeRaw: shelf,
        lastEventId: createdEv.id
      }
    });

    return { event: createdEv, branchState: next };
  });

  return { event: ev, branchState: updated };
}
