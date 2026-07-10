import type { Prisma, SelfInspectionEntrySlotKind, SelfInspectionMode } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { pickSessionForScheduleRow } from './self-inspection.service.js';
import {
  confirmedEntriesCountSelect,
  confirmedWhere
} from './self-inspection/entry-persistence-status.js';
import {
  MAX_DETAIL_MEASUREMENT_POINTS,
  MAX_HEATSTRIP_ENTRY_COLUMNS,
} from '../signage/self-inspection-machine-board/layout-contracts.js';

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
    }>;
  }>;
};

export async function fetchSelfInspectionSessionDetailsByScheduleRowIds(
  scheduleRowIds: string[]
): Promise<Map<string, SelfInspectionMachineBoardSessionDetail>> {
  const uniqueIds = [...new Set(scheduleRowIds.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const sessions = await prisma.selfInspectionSession.findMany({
    where: { scheduleRowId: { in: uniqueIds } },
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
          },
        })
      : [];

  const valuesByEntryId = new Map<string, Array<{ templateItemId: string; value: Prisma.Decimal | null }>>();
  for (const measurementValue of values) {
    const list = valuesByEntryId.get(measurementValue.entryId);
    if (list) {
      list.push({
        templateItemId: measurementValue.templateItemId,
        value: measurementValue.value,
      });
    } else {
      valuesByEntryId.set(measurementValue.entryId, [
        {
          templateItemId: measurementValue.templateItemId,
          value: measurementValue.value,
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
