import type {
  InspectionResult,
  Prisma,
  SelfInspectionEntrySlotKind,
  SelfInspectionMeasurementReviewStatus,
  SelfInspectionMode,
} from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { pickSessionForScheduleRow } from './self-inspection.service.js';
import {
  confirmedEntriesCountSelect,
  confirmedWhere,
  isConfirmed
} from './self-inspection/entry-persistence-status.js';
import {
  MAX_DETAIL_MEASUREMENT_POINTS,
  MAX_HEATSTRIP_ENTRY_COLUMNS,
} from '../signage/self-inspection-machine-board/layout-contracts.js';
import type { SelfInspectionMachineBoardOutcomeInput } from './self-inspection-machine-board-outcome.js';

export type { SignageMachineBoardScheduleRow, SignageMachineBoardScheduleFetchResult } from '../production-schedule/production-schedule-query.service.js';

export type SelfInspectionMachineBoardSessionSummary = {
  scheduleRowId: string;
  plannedQuantity: number;
  expectedEntryCount: number;
  completedAt: Date | null;
  completedEntryCount: number;
  template: {
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount: number | null;
    selfInspectionSampleSize: number | null;
  };
};

export type SelfInspectionMachineBoardSessionDetail = SelfInspectionMachineBoardSessionSummary & {
  id: string;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  totalEntryCount: number;
  totalTemplateItemCount: number;
  template: SelfInspectionMachineBoardSessionSummary['template'] & {
    items: Array<{
      id: string;
      measurementLabel: string;
      sortOrder: number;
      lowerLimit: Prisma.Decimal | null;
      upperLimit: Prisma.Decimal | null;
      nominalValue: Prisma.Decimal | null;
      decimalPlaces: number;
    }>;
  };
  entries: Array<{
    id: string;
    entryIndex: number;
    entrySlotKind: SelfInspectionEntrySlotKind;
    values: Array<{
      templateItemId: string;
      value: Prisma.Decimal | null;
      judgementResult: InspectionResult | null;
      reviewStatus: SelfInspectionMeasurementReviewStatus;
      finalReviewStatus: string | null;
    }>;
  }>;
};

export type SelfInspectionMachineBoardOutcomeRecord = SelfInspectionMachineBoardOutcomeInput & {
  scheduleRowId: string;
  sessionId: string;
  plannedQuantity: number;
  expectedEntryCount: number;
  confirmedEntryCount: number;
};

export async function fetchSelfInspectionSessionDetailsByScheduleRowIds(
  scheduleRowIds: string[]
): Promise<Map<string, SelfInspectionMachineBoardSessionDetail>> {
  const uniqueIds = [...new Set(scheduleRowIds.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const sessions = await prisma.selfInspectionSession.findMany({
    where: { scheduleRowId: { in: uniqueIds }, invalidatedAt: null },
    select: {
      id: true,
      scheduleRowId: true,
      fseiban: true,
      fhincd: true,
      fhinmei: true,
      plannedQuantity: true,
      expectedEntryCount: true,
      completedAt: true,
      updatedAt: true,
      template: {
        select: {
          selfInspectionMode: true,
          selfInspectionFixedCount: true,
          selfInspectionSampleSize: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            take: MAX_DETAIL_MEASUREMENT_POINTS,
            select: {
              id: true,
              measurementLabel: true,
              sortOrder: true,
              lowerLimit: true,
              upperLimit: true,
              nominalValue: true,
              decimalPlaces: true,
            },
          },
          _count: { select: { items: true } },
        },
      },
      entries: {
        where: confirmedWhere,
        orderBy: { entryIndex: 'asc' },
        take: MAX_HEATSTRIP_ENTRY_COLUMNS,
        select: {
          id: true,
          entryIndex: true,
          entrySlotKind: true,
        },
      },
      _count: { select: confirmedEntriesCountSelect },
    },
  });

  const sessionsByScheduleRowId = new Map<string, typeof sessions>();
  for (const session of sessions) {
    if (!session.scheduleRowId) {
      continue;
    }
    const group = sessionsByScheduleRowId.get(session.scheduleRowId) ?? [];
    group.push(session);
    sessionsByScheduleRowId.set(session.scheduleRowId, group);
  }

  const pickedSessions: Array<(typeof sessions)[number]> = [];
  for (const [scheduleRowId, candidates] of sessionsByScheduleRowId) {
    const session = pickSessionForScheduleRow(candidates, scheduleRowId);
    if (session) {
      pickedSessions.push(session);
    }
  }

  const entryIds = pickedSessions.flatMap((session) => session.entries.map((entry) => entry.id));
  const itemIds = [
    ...new Set(pickedSessions.flatMap((session) => session.template.items.map((item) => item.id))),
  ];

  const values =
    entryIds.length > 0 && itemIds.length > 0
      ? await prisma.selfInspectionMeasurementValue.findMany({
          where: {
            entryId: { in: entryIds },
            templateItemId: { in: itemIds },
          },
          select: {
            entryId: true,
            templateItemId: true,
            value: true,
            judgementResult: true,
            reviewStatus: true,
            finalReviewStatus: true,
          },
        })
      : [];

  const valuesByEntryId = new Map<
    string,
    Array<{
      templateItemId: string;
      value: Prisma.Decimal | null;
      judgementResult: InspectionResult | null;
      reviewStatus: SelfInspectionMeasurementReviewStatus;
      finalReviewStatus: string | null;
    }>
  >();
  for (const measurementValue of values) {
    const list = valuesByEntryId.get(measurementValue.entryId);
    if (list) {
      list.push({
        templateItemId: measurementValue.templateItemId,
        value: measurementValue.value,
        judgementResult: measurementValue.judgementResult,
        reviewStatus: measurementValue.reviewStatus,
        finalReviewStatus: measurementValue.finalReviewStatus,
      });
    } else {
      valuesByEntryId.set(measurementValue.entryId, [
        {
          templateItemId: measurementValue.templateItemId,
          value: measurementValue.value,
          judgementResult: measurementValue.judgementResult,
          reviewStatus: measurementValue.reviewStatus,
          finalReviewStatus: measurementValue.finalReviewStatus,
        },
      ]);
    }
  }

  const byScheduleRowId = new Map<string, SelfInspectionMachineBoardSessionDetail>();

  for (const session of pickedSessions) {
    if (!session.scheduleRowId) {
      continue;
    }

    byScheduleRowId.set(session.scheduleRowId, {
      id: session.id,
      scheduleRowId: session.scheduleRowId,
      fseiban: session.fseiban,
      fhincd: session.fhincd,
      fhinmei: session.fhinmei,
      plannedQuantity: session.plannedQuantity,
      expectedEntryCount: session.expectedEntryCount,
      completedAt: session.completedAt,
      completedEntryCount: session._count.entries,
      totalEntryCount: session._count.entries,
      totalTemplateItemCount: session.template._count.items,
      template: {
        selfInspectionMode: session.template.selfInspectionMode,
        selfInspectionFixedCount: session.template.selfInspectionFixedCount,
        selfInspectionSampleSize: session.template.selfInspectionSampleSize,
        items: session.template.items,
      },
      entries: session.entries.map((entry) => ({
        id: entry.id,
        entryIndex: entry.entryIndex,
        entrySlotKind: entry.entrySlotKind,
        values: valuesByEntryId.get(entry.id) ?? [],
      })),
    });
  }

  return byScheduleRowId;
}

function normalizeOutcomeColumn(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function isPendingOutcomeValue(value: {
  reviewStatus: SelfInspectionMeasurementReviewStatus;
  finalReviewStatus: string | null;
}): boolean {
  const finalStatus = normalizeOutcomeColumn(value.finalReviewStatus);
  return finalStatus.length > 0 ? finalStatus === 'PENDING' : value.reviewStatus === 'PENDING';
}

function isRejectedOutcomeValue(value: {
  finalReviewStatus: string | null;
}): boolean {
  return ['REJECTED', 'FAIL', 'NG'].includes(normalizeOutcomeColumn(value.finalReviewStatus));
}

/**
 * ボードのカード判定に必要な列だけを取得する軽量 repository。
 *
 * セッションの候補が複数ある場合は、通常の詳細取得と同じ
 * `pickSessionForScheduleRow` を通す。全 entry の存在は仕掛中判定へ使う一方、
 * 進捗・判定列は CONFIRMED entry だけを集計する。
 */
export async function fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds(
  scheduleRowIds: string[]
): Promise<Map<string, SelfInspectionMachineBoardOutcomeRecord>> {
  const uniqueIds = [...new Set(scheduleRowIds.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const sessions = await prisma.selfInspectionSession.findMany({
    where: { scheduleRowId: { in: uniqueIds }, invalidatedAt: null },
    select: {
      id: true,
      scheduleRowId: true,
      plannedQuantity: true,
      expectedEntryCount: true,
      completedAt: true,
      updatedAt: true,
      entries: {
        select: {
          persistenceStatus: true,
          values: {
            select: {
              judgementResult: true,
              reviewStatus: true,
              finalReviewStatus: true,
            },
          },
        },
      },
    },
  });

  const sessionsByScheduleRowId = new Map<string, typeof sessions>();
  for (const session of sessions) {
    if (!session.scheduleRowId) {
      continue;
    }
    const group = sessionsByScheduleRowId.get(session.scheduleRowId) ?? [];
    group.push(session);
    sessionsByScheduleRowId.set(session.scheduleRowId, group);
  }

  const result = new Map<string, SelfInspectionMachineBoardOutcomeRecord>();
  for (const [scheduleRowId, candidates] of sessionsByScheduleRowId) {
    const session = pickSessionForScheduleRow(candidates, scheduleRowId);
    if (!session) {
      continue;
    }
    const hasAnyLotEntry = session.entries.length > 0;
    const confirmedEntries = session.entries.filter((entry) =>
      isConfirmed(entry.persistenceStatus)
    );
    const values = confirmedEntries.flatMap((entry) => entry.values);
    const pendingReviewCount = values.filter(isPendingOutcomeValue).length;
    const directFailCount = values.filter((value) => value.judgementResult === 'FAIL').length;
    const rejectedCount = values.filter(isRejectedOutcomeValue).length;
    result.set(scheduleRowId, {
      scheduleRowId,
      sessionId: session.id,
      plannedQuantity: session.plannedQuantity,
      expectedEntryCount: session.expectedEntryCount,
      confirmedEntryCount: confirmedEntries.length,
      completedAt: session.completedAt,
      hasAnyLotEntry,
      pendingReviewCount,
      directFailCount,
      rejectedCount,
      judgementResults: values.map((value) => value.judgementResult),
      reviewStatuses: values.map((value) => value.reviewStatus),
      finalReviewStatuses: values.map((value) => value.finalReviewStatus),
      measurementOutcomes: values.map((value) => ({
        judgementResult: value.judgementResult,
        reviewStatus: value.reviewStatus,
        finalReviewStatus: value.finalReviewStatus,
      })),
    });
  }

  return result;
}

export const fetchSelfInspectionMachineBoardOutcomeInputsByScheduleRowIds =
  fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds;
