import { performance } from 'node:perf_hooks';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../lib/location-scope-resolver.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { dueManagementLearningEventRepository } from './due-management-learning-event.repository.js';
import { getProductionScheduleProcessingTypeOptions } from './production-schedule-settings.service.js';
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

export async function completeProductionScheduleRow(params: {
  rowId: string;
  locationKey: string;
  debugSessionId?: string;
}): Promise<{
  success: true;
  alreadyCompleted: false;
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
}> {
  const { rowId, locationKey, debugSessionId } = params;
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

  // トグル動作: 既に完了している場合は未完了に戻す
  const nextIsCompleted = !isCompleted;
  const nextRowData: Record<string, unknown> = {
    ...current,
    progress: nextIsCompleted ? COMPLETED_PROGRESS_VALUE : ''
  };

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

  const txStart = performance.now();
  let txUpdateRowMs = 0;
  let txDeleteAssignmentMs: number | null = null;
  let txShiftAssignmentsMs: number | null = null;
  let txShiftAssignmentsCount: number | null = null;
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
      await tx.productionScheduleOrderAssignment.delete({
        where: {
          csvDashboardRowId_location: {
            csvDashboardRowId: row.id,
            location: locationKey
          }
        }
      });
      txDeleteAssignmentMs = performance.now() - tDeleteStart;

      const tShiftStart = performance.now();
      const shiftResult = await tx.productionScheduleOrderAssignment.updateMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
          resourceCd: currentAssignment.resourceCd,
          orderNumber: { gt: currentAssignment.orderNumber }
        },
        data: { orderNumber: { decrement: 1 } }
      });
      txShiftAssignmentsMs = performance.now() - tShiftStart;
      txShiftAssignmentsCount = shiftResult.count;
    }
  });
  const txMs = performance.now() - txStart;
  const fseibanRaw = current.FSEIBAN;
  const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
  await dueManagementLearningEventRepository.saveOutcomeEvent({
    locationKey,
    eventType: 'manual_complete_toggle',
    csvDashboardRowId: row.id,
    fseiban: fseiban.length > 0 ? fseiban : null,
    isCompleted: nextIsCompleted,
    occurredAt: new Date(),
    metadata: {
      from: 'kiosk_complete_toggle'
    }
  });

  const totalMs = performance.now() - tTotalStart;

  return {
    success: true,
    alreadyCompleted: false,
    rowData: nextRowData,
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
