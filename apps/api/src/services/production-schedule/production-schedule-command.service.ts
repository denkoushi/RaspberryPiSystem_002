import { performance } from 'node:perf_hooks';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../lib/location-scope-resolver.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { dueManagementLearningEventRepository } from './due-management-learning-event.repository.js';
import { releaseOrderAssignmentAtLocation } from './order-assignment/order-assignment-release.repository.js';
import { getProductionScheduleProcessingTypeOptions } from './production-schedule-settings.service.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../part-measurement/self-inspection-machine-board.repository.js';
import { sharedScheduleFieldsRepository } from './shared-schedule-fields.repository.js';
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
  const progress = await prisma.productionScheduleProgress.findUnique({
    where: { csvDashboardRowId: row.id },
    select: { isCompleted: true }
  });
  const isCompleted = progress?.isCompleted === true;

  let nextIsCompleted: boolean;
  if (drive.mode === 'toggle') {
    nextIsCompleted = !isCompleted;
  } else {
    nextIsCompleted = drive.intent === 'complete';
  }

  const unchanged = drive.mode === 'intent' && nextIsCompleted === isCompleted;

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

  if (!unchanged) {
    await prisma.$transaction(async (tx) => {
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
    });
  }
  const txMs = performance.now() - txStart;

  const respondedRowData = buildRowDataWithProgress(current, unchanged ? isCompleted : nextIsCompleted);

  if (!unchanged) {
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
  rowId: string;
  dueDateText: string;
  locationKey: string;
}): Promise<{ success: true; dueDate: Date | null }> {
  const { rowId, dueDateText } = params;
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true, rowData: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const dueDateValue = dueDateText.trim();
  const existing = await sharedScheduleFieldsRepository.findRowNoteByRowId(row.id);

  if (dueDateValue.length === 0) {
    const existingNote = existing?.note?.trim() ?? '';
    const existingProcessing = existing?.processingType?.trim() ?? '';
    if (existingNote.length === 0 && existingProcessing.length === 0) {
      await sharedScheduleFieldsRepository.deleteRowNoteByRowId(row.id);
    } else {
      await sharedScheduleFieldsRepository.upsertRowNote({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        note: existingNote,
        dueDate: null,
        processingType: existing?.processingType ?? null
      });
    }
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return { success: true, dueDate: null };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateValue)) {
    throw new ApiError(400, '納期日はYYYY-MM-DD形式で入力してください');
  }

  const dueDate = new Date(`${dueDateValue}T00:00:00.000Z`);
  await sharedScheduleFieldsRepository.upsertRowNote({
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    csvDashboardRowId: row.id,
    note: existing?.note?.trim() ?? '',
    dueDate,
    processingType: existing?.processingType ?? null
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
  const siteKey = resolveSiteKeyFromScopeKey(locationKey.trim());
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
  const currentAssignment = await prisma.productionScheduleOrderAssignment.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    },
    select: {
      orderNumber: true,
      resourceCd: true
    }
  });
  if (rowResourceCd && rowResourceCd !== resourceCd) {
    throw new ApiError(400, '資源CDが一致しません');
  }

  if (orderNumber === null) {
    if (isSiteCanonicalLocation) {
      await prisma.productionScheduleOrderAssignment.deleteMany({
        where: {
          csvDashboardRowId: row.id,
          siteKey,
          location: { not: locationKey }
        }
      });
    }
    await prisma.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    });
    const fseibanRaw = rowData.FSEIBAN;
    const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
    const isCompleted = rowData.progress === COMPLETED_PROGRESS_VALUE;
    await dueManagementLearningEventRepository.saveOutcomeEvent({
      locationKey,
      eventType: 'manual_order_update',
      csvDashboardRowId: row.id,
      fseiban: fseiban.length > 0 ? fseiban : null,
      isCompleted,
      occurredAt: new Date(),
      metadata: {
        from: 'kiosk_order_update',
        actorLocation: actorLocationKey ?? locationKey,
        targetLocation: locationKey,
        resourceCd,
        previousResourceCd: currentAssignment?.resourceCd ?? null,
        previousOrderNumber: currentAssignment?.orderNumber ?? null,
        nextOrderNumber: null,
        reorderDelta: null
      }
    });
    return { success: true, orderNumber: null };
  }

  const conflicting = await prisma.productionScheduleOrderAssignment.findFirst({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey,
      resourceCd,
      orderNumber,
      csvDashboardRowId: { not: row.id }
    }
  });
  if (conflicting) {
    throw new ApiError(409, 'この番号は既に使用されています', undefined, 'ORDER_NUMBER_CONFLICT');
  }

  await prisma.productionScheduleOrderAssignment.upsert({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
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
      csvDashboardRowId: row.id,
      location: locationKey,
      siteKey,
      resourceCd,
      orderNumber
    }
  });
  if (isSiteCanonicalLocation) {
    await prisma.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardRowId: row.id,
        siteKey,
        location: { not: locationKey }
      }
    });
  }

  const fseibanRaw = rowData.FSEIBAN;
  const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
  const isCompleted = rowData.progress === COMPLETED_PROGRESS_VALUE;
  const reorderDelta =
    typeof currentAssignment?.orderNumber === 'number' ? orderNumber - currentAssignment.orderNumber : null;
  await dueManagementLearningEventRepository.saveOutcomeEvent({
    locationKey,
    eventType: 'manual_order_update',
    csvDashboardRowId: row.id,
    fseiban: fseiban.length > 0 ? fseiban : null,
    isCompleted,
    occurredAt: new Date(),
    metadata: {
      from: 'kiosk_order_update',
      actorLocation: actorLocationKey ?? locationKey,
      targetLocation: locationKey,
      resourceCd,
      previousResourceCd: currentAssignment?.resourceCd ?? null,
      previousOrderNumber: currentAssignment?.orderNumber ?? null,
      nextOrderNumber: orderNumber,
      reorderDelta
    }
  });

  return { success: true, orderNumber };
}
