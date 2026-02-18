import { Prisma } from '@prisma/client';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;

// Debug: track event loop stalls (global, low overhead).
// This helps detect cases where the request waits in the Node process *before* the handler runs.
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let eluPrev = performance.eventLoopUtilization();

function snapshotEventLoopHealth() {
  const eluNow = performance.eventLoopUtilization();
  const delta = performance.eventLoopUtilization(eluNow, eluPrev);
  eluPrev = eluNow;
  // monitorEventLoopDelay histogram values are in nanoseconds.
  const toMs = (n: number) => Math.round(n / 1e6);
  return {
    elu: {
      utilization: Math.round(delta.utilization * 1000) / 1000,
      activeMs: Math.round(delta.active / 1e6),
      idleMs: Math.round(delta.idle / 1e6)
    },
    eventLoopDelayMs: {
      mean: toMs(eventLoopDelay.mean),
      max: toMs(eventLoopDelay.max),
      p50: toMs(eventLoopDelay.percentile(50)),
      p90: toMs(eventLoopDelay.percentile(90)),
      p99: toMs(eventLoopDelay.percentile(99))
    }
  };
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
    eventLoop?: ReturnType<typeof snapshotEventLoopHealth>;
  };
}> {
  const { rowId, locationKey, debugSessionId } = params;
  const debugEnabled = debugSessionId === '30be23';
  const tTotalStart = performance.now();
  const eventLoop = debugEnabled ? snapshotEventLoopHealth() : null;

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
  const currentProgress = typeof current.progress === 'string' ? current.progress.trim() : '';

  // トグル動作: 既に完了している場合は未完了に戻す
  const nextRowData: Record<string, unknown> = {
    ...current,
    progress: currentProgress === COMPLETED_PROGRESS_VALUE ? '' : COMPLETED_PROGRESS_VALUE
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
    await tx.csvDashboardRow.update({
      where: { id: row.id },
      data: { rowData: nextRowData as Prisma.InputJsonValue }
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
  const { rowId, note, locationKey } = params;
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const trimmedNote = note.slice(0, 100).trim();
  const existing = await prisma.productionScheduleRowNote.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    }
  });
  if (trimmedNote.length === 0) {
    if (existing?.dueDate || (existing?.processingType && existing.processingType.trim().length > 0)) {
      await prisma.productionScheduleRowNote.update({
        where: {
          csvDashboardRowId_location: {
            csvDashboardRowId: row.id,
            location: locationKey
          }
        },
        data: { note: '' }
      });
    } else {
      await prisma.productionScheduleRowNote.deleteMany({
        where: {
          csvDashboardRowId: row.id,
          location: locationKey
        }
      });
    }
    return { success: true, note: null };
  }
  await prisma.productionScheduleRowNote.upsert({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      location: locationKey,
      note: trimmedNote
    },
    update: { note: trimmedNote }
  });

  return { success: true, note: trimmedNote };
}

export async function upsertProductionScheduleDueDate(params: {
  rowId: string;
  dueDateText: string;
  locationKey: string;
}): Promise<{ success: true; dueDate: Date | null }> {
  const { rowId, dueDateText, locationKey } = params;
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { id: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const dueDateValue = dueDateText.trim();
  const existing = await prisma.productionScheduleRowNote.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    }
  });

  if (dueDateValue.length === 0) {
    const existingNote = existing?.note?.trim() ?? '';
    const existingProcessing = existing?.processingType?.trim() ?? '';
    if (existingNote.length === 0 && existingProcessing.length === 0) {
      await prisma.productionScheduleRowNote.deleteMany({
        where: {
          csvDashboardRowId: row.id,
          location: locationKey
        }
      });
    } else {
      await prisma.productionScheduleRowNote.update({
        where: {
          csvDashboardRowId_location: {
            csvDashboardRowId: row.id,
            location: locationKey
          }
        },
        data: { dueDate: null }
      });
    }
    return { success: true, dueDate: null };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateValue)) {
    throw new ApiError(400, '納期日はYYYY-MM-DD形式で入力してください');
  }

  const dueDate = new Date(`${dueDateValue}T00:00:00.000Z`);
  await prisma.productionScheduleRowNote.upsert({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      location: locationKey,
      note: existing?.note?.trim() ?? '',
      dueDate
    },
    update: { dueDate }
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
    select: { id: true }
  });
  if (!row) {
    throw new ApiError(404, '対象の行が見つかりません');
  }

  const incomingType = processingType ?? '';
  if (incomingType.length > 0 && !PROCESSING_TYPES.includes(incomingType as (typeof PROCESSING_TYPES)[number])) {
    throw new ApiError(400, '無効な処理種別です');
  }

  const existing = await prisma.productionScheduleRowNote.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    }
  });

  if (incomingType.length === 0) {
    const existingNote = existing?.note?.trim() ?? '';
    const existingDueDate = existing?.dueDate ?? null;
    if (existingNote.length === 0 && !existingDueDate) {
      await prisma.productionScheduleRowNote.deleteMany({
        where: {
          csvDashboardRowId: row.id,
          location: locationKey
        }
      });
    } else {
      await prisma.productionScheduleRowNote.update({
        where: {
          csvDashboardRowId_location: {
            csvDashboardRowId: row.id,
            location: locationKey
          }
        },
        data: { processingType: null }
      });
    }
    return { success: true, processingType: null };
  }

  await prisma.productionScheduleRowNote.upsert({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey
      }
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      location: locationKey,
      note: existing?.note?.trim() ?? '',
      dueDate: existing?.dueDate ?? null,
      processingType: incomingType
    },
    update: { processingType: incomingType }
  });

  return { success: true, processingType: incomingType };
}

export async function upsertProductionScheduleOrder(params: {
  rowId: string;
  resourceCd: string;
  orderNumber: number | null;
  locationKey: string;
}): Promise<{ success: true; orderNumber: number | null }> {
  const { rowId, resourceCd, orderNumber, locationKey } = params;
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
    await prisma.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardRowId: row.id,
        location: locationKey
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
      orderNumber
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      location: locationKey,
      resourceCd,
      orderNumber
    }
  });

  return { success: true, orderNumber };
}
