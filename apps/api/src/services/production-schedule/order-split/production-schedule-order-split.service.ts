import type { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  buildRowDisplayItemId,
  buildSplitDisplayItemId,
  type DisplayItemId,
  type SourceRowId,
  type SplitId
} from './leaderboard-display-item-id.js';
import type { ProductionScheduleRow } from '../production-schedule-query.service.js';
import {
  acquireUnifiedOrderSlotLockInTransaction,
  acquireUnifiedOrderSlotLocksInTransaction,
  assertUnifiedOrderSlotAvailableInTransaction
} from './production-schedule-unified-order-slot.service.js';
import { acquireProductionScheduleParentRowLockInTransaction } from './production-schedule-parent-row-lock.service.js';
import {
  buildSplitAssignmentScopeInclude,
  pickPreferredScopedLocationAssignment
} from './split-assignment-scope-preference.js';
import { applySplitQuantityToProductionScheduleRowDisplayFields } from './split-display-required-minutes.js';

export type OrderSplitItemInput = {
  id?: SplitId | null;
  splitNo: number;
  splitQuantity: number;
  dueDate?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  orderNumber?: number | null;
};

export type OrderSplitItemDto = {
  id: SplitId;
  displayItemId: DisplayItemId;
  parentCsvDashboardRowId: SourceRowId;
  splitNo: number;
  splitQuantity: number;
  dueDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  orderNumber: number | null;
};

export type OrderSplitAuditContext = {
  actorClientKey?: string;
  actorLocation?: string;
  targetLocation?: string;
  siteKey?: string;
  requestId?: string;
};

function parseOptionalDateField(value: string | null | undefined, fieldLabel: string): Date | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new ApiError(400, `${fieldLabel}はYYYY-MM-DD形式で入力してください`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ApiError(400, `${fieldLabel}はYYYY-MM-DD形式で入力してください`);
  }
  return parsed;
}

function formatDateOnlyYmd(value: Date | null | undefined): string | null {
  if (value == null) return null;
  return value.toISOString().slice(0, 10);
}

function assertSplittablePlannedQuantity(plannedQuantity: number | null | undefined): number {
  if (plannedQuantity == null || !Number.isFinite(plannedQuantity)) {
    throw new ApiError(400, '指示数が未設定の行は分割できません');
  }
  if (!Number.isInteger(plannedQuantity) || plannedQuantity <= 0) {
    throw new ApiError(400, '指示数が不正な行は分割できません');
  }
  return plannedQuantity;
}

type SplitAssignmentScopeTarget =
  | { kind: 'parent'; parentCsvDashboardRowId: SourceRowId }
  | { kind: 'split'; splitId: SplitId };

/** 親 order と同様、site canonical 書き込み時は同一 site の非 canonical assignment も掃除する。 */
async function deleteSplitAssignmentsForScopeInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    target: SplitAssignmentScopeTarget;
    locationKey: string;
    siteKey: string;
    isSiteCanonicalLocation: boolean;
  }
): Promise<void> {
  const splitFilter =
    params.target.kind === 'parent'
      ? {
          split: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            parentCsvDashboardRowId: params.target.parentCsvDashboardRowId
          }
        }
      : { splitId: params.target.splitId };

  if (params.isSiteCanonicalLocation) {
    await tx.productionScheduleOrderSplitAssignment.deleteMany({
      where: {
        ...splitFilter,
        siteKey: params.siteKey,
        location: { not: params.locationKey }
      }
    });
  }

  await tx.productionScheduleOrderSplitAssignment.deleteMany({
    where: {
      ...splitFilter,
      location: params.locationKey
    }
  });
}

async function writeSplitAuditLogInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    actionType: string;
    parentCsvDashboardRowId: string;
    splitId?: string | null;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    audit?: OrderSplitAuditContext;
  }
): Promise<void> {
  const { audit } = params;
  await tx.productionScheduleOrderSplitAuditLog.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      actorClientKey: audit?.actorClientKey ?? null,
      actorLocation: audit?.actorLocation ?? null,
      targetLocation: audit?.targetLocation ?? null,
      siteKey: audit?.siteKey ?? null,
      requestId: audit?.requestId ?? null,
      actionType: params.actionType,
      parentCsvDashboardRowId: params.parentCsvDashboardRowId,
      splitId: params.splitId ?? null,
      beforeJson: params.beforeJson ?? undefined,
      afterJson: params.afterJson ?? undefined
    }
  });
}

export async function listProductionScheduleOrderSplitsForParent(
  parentCsvDashboardRowId: SourceRowId,
  locationKey: string
): Promise<{
  parentCsvDashboardRowId: SourceRowId;
  plannedQuantity: number;
  splits: OrderSplitItemDto[];
}> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: parentCsvDashboardRowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: {
      id: true,
      orderSupplements: {
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        select: { plannedQuantity: true },
        take: 1
      }
    }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const plannedQuantity = assertSplittablePlannedQuantity(row.orderSupplements[0]?.plannedQuantity ?? null);

  const splits = await prisma.productionScheduleOrderSplit.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      parentCsvDashboardRowId: row.id
    },
    orderBy: { splitNo: 'asc' },
    include: {
      assignments: buildSplitAssignmentScopeInclude(locationKey)
    }
  });

  return {
    parentCsvDashboardRowId: row.id,
    plannedQuantity,
    splits: splits.map((split) => ({
      id: split.id,
      displayItemId: buildSplitDisplayItemId(split.id),
      parentCsvDashboardRowId: row.id,
      splitNo: split.splitNo,
      splitQuantity: split.splitQuantity,
      dueDate: formatDateOnlyYmd(split.dueDate),
      plannedStartDate: formatDateOnlyYmd(split.plannedStartDate),
      plannedEndDate: formatDateOnlyYmd(split.plannedEndDate),
      orderNumber: pickPreferredScopedLocationAssignment(split.assignments, locationKey)?.orderNumber ?? null
    }))
  };
}

export async function replaceProductionScheduleOrderSplits(params: {
  parentCsvDashboardRowId: SourceRowId;
  locationKey: string;
  resourceCd: string;
  items: OrderSplitItemInput[];
  audit?: OrderSplitAuditContext;
}): Promise<{ success: true; splits: OrderSplitItemDto[] }> {
  const { parentCsvDashboardRowId, locationKey, resourceCd, items, audit } = params;
  const siteKey = resolveSiteKeyFromScopeKey(locationKey.trim());
  const isSiteCanonicalLocation = locationKey.trim() === siteKey;

  if (items.length === 0) {
    throw new ApiError(400, '分割片は1件以上必要です');
  }

  const normalizedItems = [...items]
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : null,
      splitNo: item.splitNo,
      splitQuantity: item.splitQuantity,
      dueDate: parseOptionalDateField(item.dueDate, '納期日'),
      plannedStartDate: parseOptionalDateField(item.plannedStartDate, '着手日'),
      plannedEndDate: parseOptionalDateField(item.plannedEndDate, '終期日'),
      orderNumber: item.orderNumber ?? null
    }))
    .sort((a, b) => a.splitNo - b.splitNo);

  const splitNos = new Set<number>();
  const splitIds = new Set<string>();
  let quantitySum = 0;
  for (const item of normalizedItems) {
    if (item.id != null) {
      if (splitIds.has(item.id)) {
        throw new ApiError(400, '分割片IDが重複しています');
      }
      splitIds.add(item.id);
    }
    if (!Number.isInteger(item.splitNo) || item.splitNo < 1) {
      throw new ApiError(400, 'splitNo は正の整数である必要があります');
    }
    if (splitNos.has(item.splitNo)) {
      throw new ApiError(400, 'splitNo が重複しています');
    }
    splitNos.add(item.splitNo);
    if (!Number.isInteger(item.splitQuantity) || item.splitQuantity <= 0) {
      throw new ApiError(400, '分割数量は正の整数である必要があります');
    }
    quantitySum += item.splitQuantity;
    if (item.orderNumber != null) {
      if (!Number.isInteger(item.orderNumber) || item.orderNumber < 1 || item.orderNumber > 10) {
        throw new ApiError(400, '手動順番は1〜10の整数である必要があります');
      }
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    await acquireProductionScheduleParentRowLockInTransaction(tx, parentCsvDashboardRowId);

    const row = await tx.csvDashboardRow.findFirst({
      where: { id: parentCsvDashboardRowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: {
        id: true,
        rowData: true,
        orderSupplements: {
          where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
          select: { plannedQuantity: true },
          take: 1
        }
      }
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const rowData = row.rowData as Record<string, unknown>;
    const rowResourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    if (rowResourceCd && rowResourceCd !== resourceCd.trim()) {
      throw new ApiError(400, '資源CDが一致しません');
    }

    const plannedQuantity = assertSplittablePlannedQuantity(row.orderSupplements[0]?.plannedQuantity ?? null);
    if (quantitySum !== plannedQuantity) {
      throw new ApiError(
        400,
        `分割数量の合計(${quantitySum})が指示数(${plannedQuantity})と一致しません`,
        undefined,
        'SPLIT_QUANTITY_SUM_MISMATCH'
      );
    }

    const existingSplits = await tx.productionScheduleOrderSplit.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        parentCsvDashboardRowId: row.id
      },
      include: { assignments: true },
      orderBy: { splitNo: 'asc' }
    });
    const before = existingSplits;
    const existingById = new Map(existingSplits.map((split) => [split.id, split]));
    const existingBySplitNo = new Map(existingSplits.map((split) => [split.splitNo, split]));
    const matchedExistingByItem = new Map<(typeof normalizedItems)[number], (typeof existingSplits)[number]>();
    const matchedExistingIds = new Set<string>();

    for (const item of normalizedItems) {
      const existing = item.id != null ? existingById.get(item.id) : existingBySplitNo.get(item.splitNo);
      if (item.id != null && !existing) {
        throw new ApiError(400, '分割片IDが対象行に属していません');
      }
      if (!existing) continue;
      if (matchedExistingIds.has(existing.id)) {
        throw new ApiError(400, '同じ分割片IDが複数の入力に対応しています');
      }
      matchedExistingIds.add(existing.id);
      matchedExistingByItem.set(item, existing);
    }

    await tx.productionScheduleOrderSplit.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        parentCsvDashboardRowId: row.id,
        id: { notIn: [...matchedExistingIds] }
      }
    });

    await tx.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id
      }
    });

    const upsertedSplits: Array<{
      split: { id: string; splitNo: number; splitQuantity: number; dueDate: Date | null; plannedStartDate: Date | null; plannedEndDate: Date | null };
      item: (typeof normalizedItems)[number];
    }> = [];

    for (const item of normalizedItems) {
      const existing = matchedExistingByItem.get(item);
      if (!existing) continue;
      await tx.productionScheduleOrderSplit.update({
        where: { id: existing.id },
        data: { splitNo: -item.splitNo }
      });
    }

    for (const item of normalizedItems) {
      const existing = matchedExistingByItem.get(item);
      const split = existing
        ? await tx.productionScheduleOrderSplit.update({
            where: { id: existing.id },
            data: {
              splitNo: item.splitNo,
              splitQuantity: item.splitQuantity,
              dueDate: item.dueDate,
              plannedStartDate: item.plannedStartDate,
              plannedEndDate: item.plannedEndDate
            }
          })
        : await tx.productionScheduleOrderSplit.create({
            data: {
              csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
              parentCsvDashboardRowId: row.id,
              splitNo: item.splitNo,
              splitQuantity: item.splitQuantity,
              dueDate: item.dueDate,
              plannedStartDate: item.plannedStartDate,
              plannedEndDate: item.plannedEndDate
            }
          });

      upsertedSplits.push({ split, item });
    }

    await deleteSplitAssignmentsForScopeInTransaction(tx, {
      target: { kind: 'parent', parentCsvDashboardRowId: row.id },
      locationKey,
      siteKey,
      isSiteCanonicalLocation
    });

    const requestedOrderNumbers = normalizedItems
      .map((item) => item.orderNumber)
      .filter((orderNumber): orderNumber is number => orderNumber != null);
    if (new Set(requestedOrderNumbers).size !== requestedOrderNumbers.length) {
      throw new ApiError(409, 'この番号は既に使用されています', undefined, 'ORDER_NUMBER_CONFLICT');
    }

    const trimmedResourceCd = resourceCd.trim();
    await acquireUnifiedOrderSlotLocksInTransaction(
      tx,
      normalizedItems
        .filter((item): item is (typeof normalizedItems)[number] & { orderNumber: number } => item.orderNumber != null)
        .map((item) => ({
          locationKey,
          resourceCd: trimmedResourceCd,
          orderNumber: item.orderNumber
        }))
    );

    const out: OrderSplitItemDto[] = [];
    for (const { split, item } of upsertedSplits) {
      let orderNumber: number | null = null;
      if (item.orderNumber != null) {
        await assertUnifiedOrderSlotAvailableInTransaction(tx, {
          locationKey,
          resourceCd: trimmedResourceCd,
          orderNumber: item.orderNumber
        });
        await tx.productionScheduleOrderSplitAssignment.create({
          data: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            splitId: split.id,
            location: locationKey,
            siteKey,
            resourceCd: trimmedResourceCd,
            orderNumber: item.orderNumber
          }
        });
        orderNumber = item.orderNumber;
      }

      out.push({
        id: split.id,
        displayItemId: buildSplitDisplayItemId(split.id),
        parentCsvDashboardRowId: row.id,
        splitNo: split.splitNo,
        splitQuantity: split.splitQuantity,
        dueDate: formatDateOnlyYmd(split.dueDate),
        plannedStartDate: formatDateOnlyYmd(split.plannedStartDate),
        plannedEndDate: formatDateOnlyYmd(split.plannedEndDate),
        orderNumber
      });
    }

    await writeSplitAuditLogInTransaction(tx, {
      actionType: 'replace_splits',
      parentCsvDashboardRowId: row.id,
      beforeJson: before,
      afterJson: out,
      audit
    });

    return out;
  });

  return { success: true, splits: created };
}

export async function deleteProductionScheduleOrderSplits(params: {
  parentCsvDashboardRowId: SourceRowId;
  audit?: OrderSplitAuditContext;
}): Promise<{ success: true }> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: params.parentCsvDashboardRowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  await prisma.$transaction(async (tx) => {
    await acquireProductionScheduleParentRowLockInTransaction(tx, row.id);
    const before = await tx.productionScheduleOrderSplit.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        parentCsvDashboardRowId: row.id
      },
      include: { assignments: true },
      orderBy: { splitNo: 'asc' }
    });
    await tx.productionScheduleOrderSplitAssignment.deleteMany({
      where: {
        split: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          parentCsvDashboardRowId: row.id
        }
      }
    });
    await tx.productionScheduleOrderSplit.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        parentCsvDashboardRowId: row.id
      }
    });
    await writeSplitAuditLogInTransaction(tx, {
      actionType: 'delete_splits',
      parentCsvDashboardRowId: row.id,
      beforeJson: before,
      afterJson: [],
      audit: params.audit
    });
  });

  return { success: true };
}

async function assertOrderSlotAvailableInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    locationKey: string;
    siteKey: string;
    resourceCd: string;
    orderNumber: number;
    excludeSplitId?: string;
  }
): Promise<void> {
  await acquireUnifiedOrderSlotLockInTransaction(tx, {
    locationKey: params.locationKey,
    resourceCd: params.resourceCd,
    orderNumber: params.orderNumber
  });
  await assertUnifiedOrderSlotAvailableInTransaction(tx, {
    locationKey: params.locationKey,
    resourceCd: params.resourceCd,
    orderNumber: params.orderNumber,
    excludeSplitId: params.excludeSplitId
  });
}

export async function upsertProductionScheduleSplitOrder(params: {
  splitId: SplitId;
  resourceCd: string;
  orderNumber: number | null;
  locationKey: string;
  actorLocationKey?: string;
  audit?: OrderSplitAuditContext;
}): Promise<{ success: true; orderNumber: number | null }> {
  const { splitId, resourceCd, orderNumber, locationKey, audit } = params;
  const siteKey = resolveSiteKeyFromScopeKey(locationKey.trim());
  const isSiteCanonicalLocation = locationKey.trim() === siteKey;

  const split = await prisma.productionScheduleOrderSplit.findFirst({
    where: { id: splitId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    include: {
      parentRow: { select: { id: true, rowData: true } }
    }
  });
  if (!split) {
    throw new ApiError(404, '対象の分割片が見つかりません');
  }

  const rowData = split.parentRow.rowData as Record<string, unknown>;
  const rowResourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
  const trimmedResourceCd = resourceCd.trim();
  if (rowResourceCd && rowResourceCd !== trimmedResourceCd) {
    throw new ApiError(400, '資源CDが一致しません');
  }

  if (orderNumber === null) {
    await prisma.$transaction(async (tx) => {
      await acquireProductionScheduleParentRowLockInTransaction(tx, split.parentCsvDashboardRowId);
      const currentSplit = await tx.productionScheduleOrderSplit.findFirst({
        where: { id: split.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        include: { assignments: buildSplitAssignmentScopeInclude(locationKey) }
      });
      if (!currentSplit) {
        throw new ApiError(404, '対象の分割片が見つかりません');
      }
      const before = pickPreferredScopedLocationAssignment(currentSplit.assignments, locationKey) ?? null;
      await deleteSplitAssignmentsForScopeInTransaction(tx, {
        target: { kind: 'split', splitId: currentSplit.id },
        locationKey,
        siteKey,
        isSiteCanonicalLocation
      });
      await writeSplitAuditLogInTransaction(tx, {
        actionType: 'clear_split_order',
        parentCsvDashboardRowId: currentSplit.parentCsvDashboardRowId,
        splitId: currentSplit.id,
        beforeJson: before,
        afterJson: null,
        audit
      });
    });
    return { success: true, orderNumber: null };
  }

  await prisma.$transaction(async (tx) => {
    await acquireProductionScheduleParentRowLockInTransaction(tx, split.parentCsvDashboardRowId);
    const currentSplit = await tx.productionScheduleOrderSplit.findFirst({
      where: { id: split.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      include: { assignments: buildSplitAssignmentScopeInclude(locationKey) }
    });
    if (!currentSplit) {
      throw new ApiError(404, '対象の分割片が見つかりません');
    }
    const before = pickPreferredScopedLocationAssignment(currentSplit.assignments, locationKey) ?? null;
    await assertOrderSlotAvailableInTransaction(tx, {
      locationKey,
      siteKey,
      resourceCd: trimmedResourceCd,
      orderNumber,
      excludeSplitId: currentSplit.id
    });
    await tx.productionScheduleOrderSplitAssignment.upsert({
      where: {
        splitId_location: {
          splitId: currentSplit.id,
          location: locationKey
        }
      },
      update: {
        resourceCd: trimmedResourceCd,
        orderNumber,
        siteKey
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        splitId: currentSplit.id,
        location: locationKey,
        siteKey,
        resourceCd: trimmedResourceCd,
        orderNumber
      }
    });
    if (isSiteCanonicalLocation) {
      await tx.productionScheduleOrderSplitAssignment.deleteMany({
        where: {
          splitId: currentSplit.id,
          siteKey,
          location: { not: locationKey }
        }
      });
    }
    await writeSplitAuditLogInTransaction(tx, {
      actionType: 'upsert_split_order',
      parentCsvDashboardRowId: currentSplit.parentCsvDashboardRowId,
      splitId: currentSplit.id,
      beforeJson: before,
      afterJson: { orderNumber, resourceCd: trimmedResourceCd },
      audit
    });
  });

  return { success: true, orderNumber };
}

export async function upsertProductionScheduleSplitDueDate(params: {
  splitId: SplitId;
  dueDateText: string;
  audit?: OrderSplitAuditContext;
}): Promise<{ success: true; dueDate: string | null }> {
  const split = await prisma.productionScheduleOrderSplit.findFirst({
    where: { id: params.splitId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, parentCsvDashboardRowId: true, dueDate: true }
  });
  if (!split) {
    throw new ApiError(404, '対象の分割片が見つかりません');
  }

  const dueDateValue = params.dueDateText.trim();
  if (dueDateValue.length === 0) {
    await prisma.$transaction(async (tx) => {
      await acquireProductionScheduleParentRowLockInTransaction(tx, split.parentCsvDashboardRowId);
      const currentSplit = await tx.productionScheduleOrderSplit.findFirst({
        where: { id: split.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        select: { id: true, parentCsvDashboardRowId: true, dueDate: true }
      });
      if (!currentSplit) {
        throw new ApiError(404, '対象の分割片が見つかりません');
      }
      const before = { dueDate: currentSplit.dueDate };
      const next = await tx.productionScheduleOrderSplit.update({
        where: { id: currentSplit.id },
        data: { dueDate: null }
      });
      await writeSplitAuditLogInTransaction(tx, {
        actionType: 'clear_split_due_date',
        parentCsvDashboardRowId: currentSplit.parentCsvDashboardRowId,
        splitId: currentSplit.id,
        beforeJson: before,
        afterJson: { dueDate: next.dueDate },
        audit: params.audit
      });
    });
    return { success: true, dueDate: null };
  }

  const dueDate = parseOptionalDateField(dueDateValue, '納期日');
  const updated = await prisma.$transaction(async (tx) => {
    await acquireProductionScheduleParentRowLockInTransaction(tx, split.parentCsvDashboardRowId);
    const currentSplit = await tx.productionScheduleOrderSplit.findFirst({
      where: { id: split.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true, parentCsvDashboardRowId: true, dueDate: true }
    });
    if (!currentSplit) {
      throw new ApiError(404, '対象の分割片が見つかりません');
    }
    const before = { dueDate: currentSplit.dueDate };
    const next = await tx.productionScheduleOrderSplit.update({
      where: { id: currentSplit.id },
      data: { dueDate }
    });
    await writeSplitAuditLogInTransaction(tx, {
      actionType: 'upsert_split_due_date',
      parentCsvDashboardRowId: currentSplit.parentCsvDashboardRowId,
      splitId: currentSplit.id,
      beforeJson: before,
      afterJson: { dueDate: next.dueDate },
      audit: params.audit
    });
    return next;
  });

  return { success: true, dueDate: formatDateOnlyYmd(updated.dueDate) };
}

export type SplitExpansionBundle = {
  splitsByParentId: Map<SourceRowId, Awaited<ReturnType<typeof loadSplitsForParents>>[number][]>;
};

export type DisplayItemManualSortKey = {
  processingOrder: number | null;
  parentSequence: number;
  splitNo: number | null;
  stableId: string;
};

/** 手動順番（processingOrder）で display item を資源内順位と同様に並べる。NULL は末尾。 */
export function compareDisplayItemManualSortKeys(
  a: DisplayItemManualSortKey,
  b: DisplayItemManualSortKey
): number {
  const aOrder = a.processingOrder;
  const bOrder = b.processingOrder;
  if (aOrder != null && bOrder != null) {
    if (aOrder !== bOrder) return aOrder - bOrder;
  } else if (aOrder != null) {
    return -1;
  } else if (bOrder != null) {
    return 1;
  }

  if (a.parentSequence !== b.parentSequence) {
    return a.parentSequence - b.parentSequence;
  }

  const aSplitNo = a.splitNo ?? Number.MAX_SAFE_INTEGER;
  const bSplitNo = b.splitNo ?? Number.MAX_SAFE_INTEGER;
  if (aSplitNo !== bSplitNo) return aSplitNo - bSplitNo;

  return a.stableId.localeCompare(b.stableId);
}

export function sortExpandedProductionScheduleRowsByManualOrder(
  rows: ProductionScheduleRow[],
  parentSequenceBySourceRowId: ReadonlyMap<string, number>
): ProductionScheduleRow[] {
  return [...rows].sort((a, b) =>
    compareDisplayItemManualSortKeys(
      {
        processingOrder: a.processingOrder ?? null,
        parentSequence: parentSequenceBySourceRowId.get(a.sourceRowId ?? a.id) ?? Number.MAX_SAFE_INTEGER,
        splitNo: a.splitNo ?? null,
        stableId: a.id
      },
      {
        processingOrder: b.processingOrder ?? null,
        parentSequence: parentSequenceBySourceRowId.get(b.sourceRowId ?? b.id) ?? Number.MAX_SAFE_INTEGER,
        splitNo: b.splitNo ?? null,
        stableId: b.id
      }
    )
  );
}

export function filterProductionScheduleDisplayRowsByDueDate(
  rows: ProductionScheduleRow[],
  enabled: boolean
): ProductionScheduleRow[] {
  if (!enabled) return rows;
  return rows.filter((row) => row.dueDate != null);
}

function resolveSplitProcessingOrder(
  split: Awaited<ReturnType<typeof loadSplitsForParents>>[number],
  locationKey: string
): number | null {
  return pickPreferredScopedLocationAssignment(split.assignments, locationKey)?.orderNumber ?? null;
}

async function loadSplitsForParents(parentRowIds: readonly SourceRowId[], locationKey: string) {
  if (parentRowIds.length === 0) return [];
  return prisma.productionScheduleOrderSplit.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      parentCsvDashboardRowId: { in: [...parentRowIds] }
    },
    orderBy: [{ parentCsvDashboardRowId: 'asc' }, { splitNo: 'asc' }],
    include: {
      assignments: buildSplitAssignmentScopeInclude(locationKey)
    }
  });
}

export async function buildSplitExpansionBundle(
  parentRowIds: readonly SourceRowId[],
  locationKey: string
): Promise<SplitExpansionBundle> {
  const splits = await loadSplitsForParents(parentRowIds, locationKey);
  const splitsByParentId = new Map<SourceRowId, typeof splits>();
  for (const split of splits) {
    const list = splitsByParentId.get(split.parentCsvDashboardRowId) ?? [];
    list.push(split);
    splitsByParentId.set(split.parentCsvDashboardRowId, list);
  }
  return { splitsByParentId };
}

function buildSplitDisplayProductionScheduleRow(params: {
  parent: ProductionScheduleRow;
  split: {
    id: string;
    splitNo: number;
    splitQuantity: number;
    dueDate: Date | null;
    plannedStartDate: Date | null;
    plannedEndDate: Date | null;
  };
  processingOrder: number | null;
}): ProductionScheduleRow {
  const { parent, split, processingOrder } = params;
  return {
    ...parent,
    ...applySplitQuantityToProductionScheduleRowDisplayFields(parent, split.splitQuantity),
    id: buildSplitDisplayItemId(split.id),
    sourceRowId: parent.id,
    splitId: split.id,
    splitNo: split.splitNo,
    splitQuantity: split.splitQuantity,
    isSplit: true,
    dueDate: split.dueDate ?? parent.dueDate,
    plannedStartDate: split.plannedStartDate ?? parent.plannedStartDate,
    plannedEndDate: split.plannedEndDate ?? parent.plannedEndDate,
    processingOrder
  };
}

export function expandParentRowToDisplayItems(
  row: ProductionScheduleRow,
  bundle: SplitExpansionBundle,
  locationKey: string
): ProductionScheduleRow[] {
  const parentSplits = bundle.splitsByParentId.get(row.id);
  if (!parentSplits || parentSplits.length === 0) {
    return [
      {
        ...row,
        id: buildRowDisplayItemId(row.id),
        sourceRowId: row.id,
        splitId: null,
        splitNo: null,
        splitQuantity: null,
        isSplit: false
      }
    ];
  }

  return parentSplits.map((split) =>
    buildSplitDisplayProductionScheduleRow({
      parent: row,
      split,
      processingOrder: resolveSplitProcessingOrder(split, locationKey)
    })
  );
}

export async function expandProductionScheduleRowsForOrderSplits(params: {
  rows: ProductionScheduleRow[];
  locationKey: string;
  enabled: boolean;
}): Promise<ProductionScheduleRow[]> {
  if (!params.enabled || params.rows.length === 0) {
    return params.rows.map((row) => ({
      ...row,
      id: buildRowDisplayItemId(row.id),
      sourceRowId: row.id,
      splitId: null,
      splitNo: null,
      splitQuantity: null,
      isSplit: false
    }));
  }

  const parentSequenceBySourceRowId = new Map(params.rows.map((row, index) => [row.id, index]));
  const parentIds = [...new Set(params.rows.map((r) => r.id))];
  const bundle = await buildSplitExpansionBundle(parentIds, params.locationKey);
  const out: ProductionScheduleRow[] = [];
  for (const row of params.rows) {
    const parentSplits = bundle.splitsByParentId.get(row.id);
    if (parentSplits && parentSplits.length > 0) {
      out.push(...expandParentRowToDisplayItems(row, bundle, params.locationKey));
    } else {
      out.push({
        ...row,
        id: buildRowDisplayItemId(row.id),
        sourceRowId: row.id,
        splitId: null,
        splitNo: null,
        splitQuantity: null,
        isSplit: false
      });
    }
  }
  return sortExpandedProductionScheduleRowsByManualOrder(out, parentSequenceBySourceRowId);
}

export async function expandOrderedDisplayItemIdsFromParentRowIds(params: {
  parentRowIds: readonly SourceRowId[];
  parentProcessingOrderByRowId?: ReadonlyMap<SourceRowId, number | null>;
  locationKey: string;
  enabled: boolean;
}): Promise<DisplayItemId[]> {
  if (!params.enabled) {
    return params.parentRowIds.map((id) => buildRowDisplayItemId(id));
  }

  const bundle = await buildSplitExpansionBundle(params.parentRowIds, params.locationKey);
  const sortKeys: Array<DisplayItemManualSortKey & { displayItemId: DisplayItemId }> = [];
  for (let parentSequence = 0; parentSequence < params.parentRowIds.length; parentSequence++) {
    const parentId = params.parentRowIds[parentSequence]!;
    const splits = bundle.splitsByParentId.get(parentId);
    if (splits && splits.length > 0) {
      for (const split of splits) {
        sortKeys.push({
          displayItemId: buildSplitDisplayItemId(split.id),
          processingOrder: resolveSplitProcessingOrder(split, params.locationKey),
          parentSequence,
          splitNo: split.splitNo,
          stableId: buildSplitDisplayItemId(split.id)
        });
      }
      continue;
    }

    sortKeys.push({
      displayItemId: buildRowDisplayItemId(parentId),
      processingOrder: params.parentProcessingOrderByRowId?.get(parentId) ?? null,
      parentSequence,
      splitNo: null,
      stableId: buildRowDisplayItemId(parentId)
    });
  }

  sortKeys.sort((a, b) => compareDisplayItemManualSortKeys(a, b));
  return sortKeys.map((key) => key.displayItemId);
}

export async function buildDisplayItemIdsByParentRowId(params: {
  parentRowIds: readonly SourceRowId[];
  locationKey: string;
  enabled: boolean;
}): Promise<Map<SourceRowId, DisplayItemId[]>> {
  const out = new Map<SourceRowId, DisplayItemId[]>();
  if (params.parentRowIds.length === 0) {
    return out;
  }

  if (!params.enabled) {
    for (const parentId of params.parentRowIds) {
      out.set(parentId, [buildRowDisplayItemId(parentId)]);
    }
    return out;
  }

  const bundle = await buildSplitExpansionBundle(params.parentRowIds, params.locationKey);
  for (const parentId of params.parentRowIds) {
    const splits = bundle.splitsByParentId.get(parentId);
    if (splits && splits.length > 0) {
      out.set(
        parentId,
        splits.map((split) => buildSplitDisplayItemId(split.id))
      );
    } else {
      out.set(parentId, [buildRowDisplayItemId(parentId)]);
    }
  }
  return out;
}

export async function hydrateDisplayItemsFromParentRows(params: {
  orderedDisplayItemIds: readonly DisplayItemId[];
  hydratedParentRows: ProductionScheduleRow[];
  locationKey: string;
  enabled: boolean;
}): Promise<ProductionScheduleRow[]> {
  const parentById = new Map(params.hydratedParentRows.map((row) => [row.id, row]));
  if (!params.enabled) {
    const out: ProductionScheduleRow[] = [];
    for (const displayId of params.orderedDisplayItemIds) {
      const parent = parentById.get(displayId);
      if (!parent) continue;
      out.push({
        ...parent,
        id: buildRowDisplayItemId(parent.id),
        sourceRowId: parent.id,
        splitId: null,
        splitNo: null,
        splitQuantity: null,
        isSplit: false
      });
    }
    return out;
  }

  const splitIds = params.orderedDisplayItemIds
    .filter((id) => id.startsWith('split:'))
    .map((id) => id.slice('split:'.length));
  const splitMeta =
    splitIds.length > 0
      ? await prisma.productionScheduleOrderSplit.findMany({
          where: { id: { in: splitIds }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
          include: {
            assignments: buildSplitAssignmentScopeInclude(params.locationKey)
          }
        })
      : [];
  const splitById = new Map(splitMeta.map((s) => [s.id, s]));
  const bundle = await buildSplitExpansionBundle(
    [...parentById.keys()],
    params.locationKey
  );

  const out: ProductionScheduleRow[] = [];
  for (const displayId of params.orderedDisplayItemIds) {
    if (!displayId.startsWith('split:')) {
      const parent = parentById.get(displayId);
      if (!parent) continue;
      const splits = bundle.splitsByParentId.get(parent.id);
      if (splits && splits.length > 0) continue;
      out.push({
        ...parent,
        id: buildRowDisplayItemId(parent.id),
        sourceRowId: parent.id,
        splitId: null,
        splitNo: null,
        splitQuantity: null,
        isSplit: false
      });
      continue;
    }

    const splitId = displayId.slice('split:'.length);
    const split = splitById.get(splitId);
    if (!split) continue;
    const parent = parentById.get(split.parentCsvDashboardRowId);
    if (!parent) continue;
    out.push(
      buildSplitDisplayProductionScheduleRow({
        parent,
        split,
        processingOrder:
          pickPreferredScopedLocationAssignment(split.assignments, params.locationKey)?.orderNumber ?? null
      })
    );
  }
  return out;
}

export function resolveSourceRowIdsForDisplayItemScope(
  displayItemIds: readonly DisplayItemId[]
): SourceRowId[] {
  const seen = new Set<string>();
  const out: SourceRowId[] = [];
  for (const raw of displayItemIds) {
    if (!raw.startsWith('split:')) {
      const id = raw.trim();
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
      continue;
    }
  }
  return out;
}

export async function resolveHydrateSourceRowIdsFromDisplayItemIds(
  displayItemIds: readonly DisplayItemId[]
): Promise<SourceRowId[]> {
  const direct = resolveSourceRowIdsForDisplayItemScope(displayItemIds);
  const splitIds = displayItemIds
    .filter((id) => id.startsWith('split:'))
    .map((id) => id.slice('split:'.length));

  if (splitIds.length === 0) {
    return direct;
  }

  const splits = await prisma.productionScheduleOrderSplit.findMany({
    where: { id: { in: splitIds }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { parentCsvDashboardRowId: true }
  });

  const seen = new Set(direct);
  const out = [...direct];
  for (const split of splits) {
    if (!seen.has(split.parentCsvDashboardRowId)) {
      seen.add(split.parentCsvDashboardRowId);
      out.push(split.parentCsvDashboardRowId);
    }
  }
  return out;
}
