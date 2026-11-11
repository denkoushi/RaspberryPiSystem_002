import type { Prisma } from '@prisma/client';
import type { ProductionScheduleAutoRankRequest, ProductionScheduleAutoRankResponse } from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { resolveSiteKeyForScopeKey } from '../../lib/site-directory.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { dueManagementLearningEventRepository } from './due-management-learning-event.repository.js';
import { acquireProductionScheduleParentRowLockInTransaction } from './order-assignment/production-schedule-parent-row-lock.service.js';
import {
  acquireUnifiedOrderSlotLockInTransaction,
  acquireUnifiedOrderSlotLocksInTransaction,
  assertUnifiedOrderSlotAvailableInTransaction
} from './order-assignment/production-schedule-unified-order-slot.service.js';

export async function assignProductionScheduleOrderInTransaction(tx: Prisma.TransactionClient, params: {
  rowId: string;
  resourceCd: string;
  orderNumber: number;
  locationKey: string;
  actorLocationKey?: string;
  onlyIfUnassigned?: boolean;
}): Promise<void> {
  const { rowId, resourceCd, orderNumber, locationKey, actorLocationKey } = params;
  const siteKey = resolveSiteKeyForScopeKey(locationKey.trim());
  const isSiteCanonicalLocation = locationKey === siteKey;
  await acquireProductionScheduleParentRowLockInTransaction(tx, rowId);
  const currentRow = await tx.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, rowData: true }
  });
  if (!currentRow) {
    throw new ApiError(404, '対象の行が見つかりません');
  }
  const lockedAssignment = await tx.productionScheduleOrderAssignment.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: currentRow.id,
        location: locationKey
      }
    },
    select: { orderNumber: true, resourceCd: true }
  });
  const displayedAssignment = params.onlyIfUnassigned && isSiteCanonicalLocation && !lockedAssignment
    ? await tx.productionScheduleOrderAssignment.findFirst({
      where: { csvDashboardRowId: rowId, siteKey },
      orderBy: { updatedAt: 'desc' },
      select: { orderNumber: true }
    })
    : lockedAssignment;
  if (params.onlyIfUnassigned && displayedAssignment?.orderNumber != null) {
    throw new ApiError(409, '対象の行には既に順位が設定されています', undefined, 'AUTO_RANK_ROW_ALREADY_ASSIGNED');
  }
  const rowResourceCd = typeof currentRow.rowData === 'object' && currentRow.rowData !== null
    ? (currentRow.rowData as Record<string, unknown>).FSIGENCD : undefined;
  if (typeof rowResourceCd === 'string' && rowResourceCd && rowResourceCd !== resourceCd) {
    throw new ApiError(400, '資源CDが一致しません');
  }
  await acquireUnifiedOrderSlotLockInTransaction(tx, {
    locationKey,
    resourceCd,
    orderNumber
  });
  await assertUnifiedOrderSlotAvailableInTransaction(tx, {
    locationKey,
    resourceCd,
    orderNumber,
    excludeParentRowId: rowId
  });

  await tx.productionScheduleOrderAssignment.upsert({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: rowId,
        location: locationKey
      }
    },
    update: {
      resourceCd,
      orderNumber,
      siteKey
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: rowId,
      location: locationKey,
      siteKey,
      resourceCd,
      orderNumber
    }
  });
  if (isSiteCanonicalLocation) {
    await tx.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardRowId: rowId,
        siteKey,
        location: { not: locationKey }
      }
    });
  }
  const lockedRowData = currentRow.rowData as Record<string, unknown>;
  const fseibanRaw = lockedRowData.FSEIBAN;
  const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
  const isCompleted = lockedRowData.progress === COMPLETED_PROGRESS_VALUE;
  const reorderDelta =
    typeof lockedAssignment?.orderNumber === 'number' ? orderNumber - lockedAssignment.orderNumber : null;
  await dueManagementLearningEventRepository.saveOutcomeEvent({
    locationKey,
    eventType: 'manual_order_update',
    csvDashboardRowId: currentRow.id,
    fseiban: fseiban.length > 0 ? fseiban : null,
    isCompleted,
    occurredAt: new Date(),
    metadata: {
      from: 'kiosk_order_update',
      actorLocation: actorLocationKey ?? locationKey,
      targetLocation: locationKey,
      resourceCd,
      previousResourceCd: lockedAssignment?.resourceCd ?? null,
      previousOrderNumber: lockedAssignment?.orderNumber ?? null,
      nextOrderNumber: orderNumber,
      reorderDelta
    }
  }, tx);
}

export async function autoRankProductionScheduleOrder(params: ProductionScheduleAutoRankRequest & {
  locationKey: string;
  actorLocationKey?: string;
}): Promise<ProductionScheduleAutoRankResponse> {
  const assignments = [...params.assignments].sort((a, b) => a.rowId.localeCompare(b.rowId));
  await prisma.$transaction(async (tx) => {
    // Take every parent lock before slot locks, then every slot in a fixed order.
    for (const { rowId } of assignments) {
      await acquireProductionScheduleParentRowLockInTransaction(tx, rowId);
    }
    await acquireUnifiedOrderSlotLocksInTransaction(tx, assignments.map(({ orderNumber }) => ({
      locationKey: params.locationKey, resourceCd: params.resourceCd, orderNumber
    })));
    for (const assignment of assignments) {
      await assignProductionScheduleOrderInTransaction(tx, {
        ...params, ...assignment, onlyIfUnassigned: true
      });
    }
  });
  return { success: true, assignments: params.assignments };
}
