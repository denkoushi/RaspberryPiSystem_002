import { runSessakuPieceOperation, type PieceAuditContext } from './sessaku-pieces/piece-audit.js';
import type { SessakuPieceSet } from './sessaku-pieces/piece-key.js';
import { syncWholePiecesOperationCompletions } from './sessaku-pieces/piece-operation-definitions.js';
import { readOverrides } from './grinding-planning-board/source.js';
import { runDueDateTransaction } from './due-date-transaction.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, findSessakuPieceWinner, sessakuPieceParentItemId, readSessakuPieceSet, sessakuPieceKeyFromRow, supportsSessakuPieceRelations } from './sessaku-pieces/piece-key.js';
import { reconcileSessakuPieceQuantities } from './sessaku-pieces/piece-quantity.js';
import { reconcileSessakuPieceProgress } from './sessaku-pieces/piece-completion.js';
import { performance } from 'node:perf_hooks';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { resolveSiteKeyForScopeKey } from '../../lib/site-directory.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../part-measurement/self-inspection-machine-board-cache-invalidation.js';
import { dueManagementLearningEventRepository } from './due-management-learning-event.repository.js';
import { releaseOrderAssignmentAtLocation } from './order-assignment/order-assignment-release.repository.js';
import { getProductionScheduleProcessingTypeOptions } from './production-schedule-settings.service.js';
import { sharedScheduleFieldsRepository } from './shared-schedule-fields.repository.js';
import { assignProductionScheduleOrderInTransaction } from './production-schedule-auto-rank.service.js';
import { acquireProductionScheduleParentRowLockInTransaction } from './order-assignment/production-schedule-parent-row-lock.service.js';
import { snapshotEventLoopObservability } from '../system/event-loop-observability.js';

const isValidProcessingType = async (locationKey: string, processingType: string): Promise<boolean> => {
  const settings = await getProductionScheduleProcessingTypeOptions(locationKey);
  const enabledCodes = new Set(
    settings.options.filter((option) => option.enabled).map((option) => option.code)
  );
  return enabledCodes.has(processingType);
};

export async function upsertProductionSchedulePartProcessingTypeByFhincd(params: {
  fhincd: string;
  processingType: string;
  locationKey: string;
}): Promise<{ success: true; processingType: string | null }> {
  const { locationKey } = params;
  const fhincd = params.fhincd.trim();
  const incomingType = params.processingType.trim();
  if (fhincd.length === 0) {
    throw new ApiError(400, '部品コードは必須です');
  }
  if (incomingType.length > 0 && !(await isValidProcessingType(locationKey, incomingType))) {
    throw new ApiError(400, '無効な処理種別です');
  }

  if (incomingType.length === 0) {
    await sharedScheduleFieldsRepository.deletePartProcessingType(PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd);
    return { success: true, processingType: null };
  }

  await sharedScheduleFieldsRepository.upsertPartProcessingType({
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    fhincd,
    processingType: incomingType
  });

  return { success: true, processingType: incomingType };
}

export type ProductionScheduleCompletionDrive =
  | { mode: 'toggle' }
  | { mode: 'intent'; intent: 'complete' | 'incomplete' };

export type ProductionScheduleCompletionResult = {
  success: true;
  /** 後方互換: 従来トグル経路では常に false */
  alreadyCompleted: boolean;
  /** 意図指定で状態が変わらなかったとき true */
  unchanged: boolean;
  rowData: Record<string, unknown>;
  debug?: {
    totalMs: number;
    findRowMs: number;
    findAssignmentMs: number;
    txMs: number;
    txUpdateRowMs: number;
    txDeleteAssignmentMs: number | null;
    txShiftAssignmentsMs: number | null;
    txShiftAssignmentsCount: number | null;
    hadAssignment: boolean;
    eventLoop?: ReturnType<typeof snapshotEventLoopObservability>;
  };
};

function buildRowDataWithProgress(
  current: Record<string, unknown>,
  isCompleted: boolean
): Record<string, unknown> {
  return {
    ...current,
    progress: isCompleted ? COMPLETED_PROGRESS_VALUE : ''
  };
}

async function parentPieceAuditSnapshot(tx: Parameters<typeof syncWholePiecesOperationCompletions>[0], set: SessakuPieceSet) {
  const operations = await tx.productionScheduleSessakuPieceOpCompletion.findMany({
    where: { pieceId: { in: set.pieces.map((piece) => piece.id) } }, select: { pieceId: true, opNo: true },
    orderBy: [{ pieceId: 'asc' }, { opNo: 'asc' }]
  });
  return { count: set.pieces.length, quantities: set.pieces.map((piece) => piece.quantity),
    pieceIds: set.pieces.map((piece) => piece.id), completedPieceIds: set.pieces.filter((piece) => piece.isCompleted).map((piece) => piece.id),
    plannedQuantity: set.plannedQuantity, operations };
}

/**
 * キオスク完了状態を更新する共通実装。
 * - `toggle`: 既存互換の反転
 * - `intent`: 明示的に完了/未完了へ（同じ状態への再適用は no-op）
 */
export async function driveProductionScheduleRowCompletion(params: {
  rowId: string;
  locationKey: string;
  drive: ProductionScheduleCompletionDrive;
  debugSessionId?: string;
}): Promise<ProductionScheduleCompletionResult> {
  const { rowId, locationKey, drive, debugSessionId } = params;
  const debugEnabled = debugSessionId === '30be23';
  const tTotalStart = performance.now();
  const eventLoop = debugEnabled ? snapshotEventLoopObservability() : null;

  const tFindRowStart = performance.now();
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, rowData: true }
  });
  const findRowMs = performance.now() - tFindRowStart;
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const current = row.rowData as Record<string, unknown>;
  let isCompleted = false;
  let nextIsCompleted = false;
  let unchanged = false;

  const tFindAssignmentStart = performance.now();
  const currentAssignment = await prisma.productionScheduleOrderAssignment.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    }
  });
  const findAssignmentMs = performance.now() - tFindAssignmentStart;

  let txUpdateRowMs = 0;
  let txDeleteAssignmentMs: number | null = null;
  let txShiftAssignmentsMs: number | null = null;
  let txShiftAssignmentsCount: number | null = null;
  const txStart = performance.now();

  let pieceHandled = false;
  let pieceAudit: PieceAuditContext | undefined;
  const key = sessakuPieceKeyFromRow(current);
  await prisma.$transaction(async (tx) => {
      // The logical group also serializes ordinary completion with first split creation.
      await acquireSessakuPieceLogicalLocks(tx, [key]);
      const set = await readSessakuPieceSet(tx, key);
      const related = supportsSessakuPieceRelations(key) ? await tx.productionScheduleSessakuPieceSet.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: key.fseiban, fhincd: key.fhincd,
          OR: [{ pieces: { some: {} } }, { sourcePieceSetId: { not: null } }] }, select: { id: true }
      }) : [];
      if (set?.pieces.length || set?.sourcePieceSetId || related.length) await acquireSessakuPieceBoardStateLocks(tx);
      await acquireProductionScheduleParentRowLockInTransaction(tx, row.id);
      await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${row.id} FOR UPDATE`;
      const latest = await tx.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: row.id } });
      isCompleted = latest?.isCompleted === true;
      nextIsCompleted = drive.mode === 'toggle' ? !isCompleted : drive.intent === 'complete';
      unchanged = drive.mode === 'intent' && nextIsCompleted === isCompleted;
      if (set) {
        const winner = await findSessakuPieceWinner(tx, key);
        if (winner?.id !== row.id) throw new ApiError(409, '元行が更新されています', undefined, 'SOURCE_ITEM_MISSING');
      }
      if (set?.pieces.length) {
        pieceHandled = true;
        const external = await tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: row.id } });
        if (external?.isExternallyCompleted && !nextIsCompleted) throw new ApiError(409, '外部完了は取消できません', undefined, 'EXTERNALLY_COMPLETED_ITEM');
        if (external?.isExternallyCompleted) { unchanged = true; nextIsCompleted = true; return; }
        const siteKey = resolveSiteKeyForScopeKey(locationKey);
        const parentId = sessakuPieceParentItemId(key);
        pieceAudit = { action: nextIsCompleted ? 'complete' : 'uncomplete', siteKey, parentItemId: parentId, fseiban: key.fseiban,
          pieceIds: set.pieces.map((piece) => piece.id), expectedVersion: set.version,
          beforeJson: await parentPieceAuditSnapshot(tx, set) };
        const overrides = await readOverrides(tx, siteKey, [parentId, ...set.pieces.map((piece) => `piece:${piece.id}`)]);
        const operationChanged = await syncWholePiecesOperationCompletions(tx, siteKey, set.pieces.map((piece) => {
          const override = overrides.get(`piece:${piece.id}`) ?? overrides.get(parentId);
          return { id: piece.id, isCompleted: piece.isCompleted, effectiveResourceCd: (override?.overrideResourceCd ?? key.fsigencd).trim(), fhincd: key.fhincd };
        }), nextIsCompleted);
        const changed = set.pieces.some((piece) => piece.isCompleted !== nextIsCompleted);
        if (operationChanged && !changed) await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { version: { increment: 1 } } });
        if (changed) {
          await tx.productionScheduleSessakuPiece.updateMany({ where: { pieceSetId: set.id }, data: { isCompleted: nextIsCompleted, completedAt: nextIsCompleted ? new Date() : null } });
          await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { version: { increment: 1 } } });
        }
        const supplement = await tx.productionScheduleOrderSupplement.findFirst({ where: { csvDashboardRowId: row.id } });
        await reconcileSessakuPieceQuantities(tx, key, supplement?.plannedQuantity ?? null);
        const result = await reconcileSessakuPieceProgress(tx, key, { emptyIsIncomplete: true });
        nextIsCompleted = result?.parentIsCompleted ?? false;
        unchanged = !changed && !operationChanged && nextIsCompleted === isCompleted;
        const saved = await readSessakuPieceSet(tx, key);
        if (saved) Object.assign(pieceAudit, { resultPieceIds: saved.pieces.map((piece) => piece.id), resultVersion: saved.version,
          afterJson: await parentPieceAuditSnapshot(tx, saved) });
        return;
      }
      if (unchanged) return;
      const tUpdateRowStart = performance.now();
      await tx.productionScheduleProgress.upsert({
        where: { csvDashboardRowId: row.id },
        create: {
          csvDashboardRowId: row.id,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          isCompleted: nextIsCompleted
        },
        update: { isCompleted: nextIsCompleted }
      });
      txUpdateRowMs = performance.now() - tUpdateRowStart;

      if (currentAssignment) {
        const tDeleteStart = performance.now();
        const releaseResult = await releaseOrderAssignmentAtLocation(tx, {
          csvDashboardRowId: row.id,
          location: locationKey
        });
        txDeleteAssignmentMs = performance.now() - tDeleteStart;
        txShiftAssignmentsMs = txDeleteAssignmentMs;
        txShiftAssignmentsCount = releaseResult.shiftCount;
      }
    }, { timeout: 30000, maxWait: 15000 });
  const txMs = performance.now() - txStart;
  // Match piece APIs: audit persistence is best effort and outside the committed business transaction.
  if (pieceAudit) await runSessakuPieceOperation(pieceAudit, async () => undefined);

  const respondedRowData = buildRowDataWithProgress(current, unchanged ? isCompleted : nextIsCompleted);

  if (!unchanged && !pieceHandled) {
    const fseibanRaw = current.FSEIBAN;
    const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
    const eventType =
      drive.mode === 'toggle'
        ? 'manual_complete_toggle'
        : nextIsCompleted
          ? 'manual_complete_set'
          : 'manual_incomplete_set';
    await dueManagementLearningEventRepository.saveOutcomeEvent({
      locationKey,
      eventType,
      csvDashboardRowId: row.id,
      fseiban: fseiban.length > 0 ? fseiban : null,
      isCompleted: nextIsCompleted,
      occurredAt: new Date(),
      metadata: {
        from: drive.mode === 'toggle' ? 'kiosk_complete_toggle' : 'kiosk_complete_intent',
        ...(drive.mode === 'intent' ? { intent: drive.intent } : {})
      }
    });
  }

  const totalMs = performance.now() - tTotalStart;

  return {
    success: true,
    alreadyCompleted: false,
    unchanged,
    rowData: respondedRowData,
    ...(debugEnabled
      ? {
          debug: {
            totalMs: Math.round(totalMs),
            findRowMs: Math.round(findRowMs),
            findAssignmentMs: Math.round(findAssignmentMs),
            txMs: Math.round(txMs),
            txUpdateRowMs: Math.round(txUpdateRowMs),
            txDeleteAssignmentMs: txDeleteAssignmentMs === null ? null : Math.round(txDeleteAssignmentMs),
            txShiftAssignmentsMs: txShiftAssignmentsMs === null ? null : Math.round(txShiftAssignmentsMs),
            txShiftAssignmentsCount,
            hadAssignment: Boolean(currentAssignment),
            eventLoop: eventLoop ?? undefined
          }
        }
      : {})
  };
}

/** @deprecated 互換用。新規は {@link driveProductionScheduleRowCompletion} の `intent` を利用してください。 */
export async function completeProductionScheduleRow(params: {
  rowId: string;
  locationKey: string;
  debugSessionId?: string;
}): Promise<ProductionScheduleCompletionResult> {
  return driveProductionScheduleRowCompletion({
    ...params,
    drive: { mode: 'toggle' }
  });
}

export async function setProductionScheduleRowCompletionIntent(params: {
  rowId: string;
  locationKey: string;
  intent: 'complete' | 'incomplete';
  debugSessionId?: string;
}): Promise<ProductionScheduleCompletionResult> {
  return driveProductionScheduleRowCompletion({
    rowId: params.rowId,
    locationKey: params.locationKey,
    drive: { mode: 'intent', intent: params.intent },
    debugSessionId: params.debugSessionId
  });
}

export async function upsertProductionScheduleNote(params: {
  rowId: string;
  note: string;
  locationKey: string;
}): Promise<{ success: true; note: string | null }> {
  const { rowId, note } = params;
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, rowData: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const trimmedNote = note.slice(0, 100).trim();
  const existing = await sharedScheduleFieldsRepository.findRowNoteByRowId(row.id);
  if (trimmedNote.length === 0) {
    if (existing?.dueDate || (existing?.processingType && existing.processingType.trim().length > 0)) {
      await sharedScheduleFieldsRepository.upsertRowNote({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        note: '',
        dueDate: existing?.dueDate ?? null,
        processingType: existing?.processingType ?? null
      });
    } else {
      await sharedScheduleFieldsRepository.deleteRowNoteByRowId(row.id);
    }
    return { success: true, note: null };
  }
  await sharedScheduleFieldsRepository.upsertRowNote({
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    csvDashboardRowId: row.id,
    note: trimmedNote,
    dueDate: existing?.dueDate ?? null,
    processingType: existing?.processingType ?? null
  });

  return { success: true, note: trimmedNote };
}

export async function upsertProductionScheduleDueDate(params: {
  actorClientDeviceId?: string;
  actorDeviceName?: string;
  rowId: string;
  dueDateText: string;
  locationKey: string;
}): Promise<{ success: true; dueDate: Date | null }> {
  const { rowId, dueDateText } = params;
  const dueDate = await runDueDateTransaction(async (tx) => {
    const row = await tx.csvDashboardRow.findFirst({
      where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true, rowData: true }
    });
    if (!row) throw new ApiError(404, '対象の行が見つかりません');
    const dueDateValue = dueDateText.trim();
    if (dueDateValue && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateValue)) {
      throw new ApiError(400, '納期日はYYYY-MM-DD形式で入力してください');
    }
    const dueDate = dueDateValue ? new Date(`${dueDateValue}T00:00:00.000Z`) : null;
    const existing = await sharedScheduleFieldsRepository.findRowNoteByRowId(row.id, tx);
    const note = existing?.note?.trim() ?? '';
    const processingType = existing?.processingType ?? null;
    if (!dueDate && !note && !processingType?.trim()) {
      await sharedScheduleFieldsRepository.deleteRowNoteByRowId(row.id, tx);
    } else {
      await sharedScheduleFieldsRepository.upsertRowNote({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id, note, dueDate, processingType
      }, tx);
    }
    await tx.productionScheduleDueDateAuditLog.create({ data: {
      actorClientDeviceId: params.actorClientDeviceId,
      actorDeviceName: params.actorDeviceName,
      location: params.locationKey, action: 'row', csvDashboardRowId: row.id,
      beforeDueDate: existing?.dueDate ?? null, afterDueDate: dueDate
    } });
    return dueDate;
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return { success: true, dueDate };
}

export async function upsertProductionScheduleProcessingType(params: {
  rowId: string;
  processingType: string;
  locationKey: string;
}): Promise<{ success: true; processingType: string | null }> {
  const { rowId, processingType, locationKey } = params;
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, rowData: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const incomingType = processingType ?? '';
  if (incomingType.length > 0 && !(await isValidProcessingType(locationKey, incomingType))) {
    throw new ApiError(400, '無効な処理種別です');
  }

  const rowData = row.rowData as Record<string, unknown>;
  const fhincd = String(rowData.FHINCD ?? '').trim();

  if (fhincd.length > 0) {
    await upsertProductionSchedulePartProcessingTypeByFhincd({
      fhincd,
      processingType: incomingType,
      locationKey
    });
  }

  const existing = await sharedScheduleFieldsRepository.findRowNoteByRowId(row.id);

  if (incomingType.length === 0) {
    const existingNote = existing?.note?.trim() ?? '';
    const existingDueDate = existing?.dueDate ?? null;
    if (existingNote.length === 0 && !existingDueDate) {
      await sharedScheduleFieldsRepository.deleteRowNoteByRowId(row.id);
    } else {
      await sharedScheduleFieldsRepository.upsertRowNote({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        note: existingNote,
        dueDate: existingDueDate,
        processingType: null
      });
    }
    return { success: true, processingType: null };
  }

  await sharedScheduleFieldsRepository.upsertRowNote({
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    csvDashboardRowId: row.id,
    note: existing?.note?.trim() ?? '',
    dueDate: existing?.dueDate ?? null,
    processingType: incomingType
  });

  return { success: true, processingType: incomingType };
}

export async function upsertProductionScheduleOrder(params: {
  rowId: string;
  resourceCd: string;
  orderNumber: number | null;
  locationKey: string;
  actorLocationKey?: string;
}): Promise<{ success: true; orderNumber: number | null }> {
  const { rowId, resourceCd, orderNumber, locationKey, actorLocationKey } = params;
  const siteKey = resolveSiteKeyForScopeKey(locationKey.trim());
  const isSiteCanonicalLocation = locationKey === siteKey;
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, rowData: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const rowData = row.rowData as Record<string, unknown>;
  const rowResourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD : '';
  if (rowResourceCd && rowResourceCd !== resourceCd) {
    throw new ApiError(400, '資源CDが一致しません');
  }

  if (orderNumber === null) {
    await prisma.$transaction(async (tx) => {
      await acquireProductionScheduleParentRowLockInTransaction(tx, row.id);
      const currentRow = await tx.csvDashboardRow.findFirst({
        where: { id: row.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
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
      if (isSiteCanonicalLocation) {
        await tx.productionScheduleOrderAssignment.deleteMany({
          where: {
            csvDashboardRowId: currentRow.id,
            siteKey,
            location: { not: locationKey }
          }
        });
      }
      await tx.productionScheduleOrderAssignment.deleteMany({
        where: {
          csvDashboardRowId: currentRow.id,
          location: locationKey
        }
      });
      const lockedRowData = currentRow.rowData as Record<string, unknown>;
      const fseibanRaw = lockedRowData.FSEIBAN;
      const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
      const isCompleted = lockedRowData.progress === COMPLETED_PROGRESS_VALUE;
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
          nextOrderNumber: null,
          reorderDelta: null
        }
      }, tx);
    });
    return { success: true, orderNumber: null };
  }

  await prisma.$transaction((tx) => assignProductionScheduleOrderInTransaction(tx, {
    rowId, resourceCd, orderNumber, locationKey, actorLocationKey
  }));

  return { success: true, orderNumber };
}
