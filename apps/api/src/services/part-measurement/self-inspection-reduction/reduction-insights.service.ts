import type { Prisma, SelfInspectionMode } from '@prisma/client';
import type { SelfInspectionReductionLevel } from '@raspi-system/shared-types';

import { prisma } from '../../../lib/prisma.js';
import { resolveTemplateFixedCount, serializeSelfInspectionMode } from '../self-inspection-config.js';

import {
  buildReductionPartInsight,
  medianSecondsPerPiece,
  partKeyString,
  type ReductionActiveTemplateRow,
  type ReductionChangePointRow,
  type ReductionDecisionRow,
  type ReductionPartInsightDto,
  type ReductionProcessGroup,
  type ReductionSessionRow
} from './reduction-insights.aggregate.js';

export const SELF_INSPECTION_REDUCTION_PERIOD_DAYS = [30, 90, 180] as const;
export type SelfInspectionReductionPeriodDays = (typeof SELF_INSPECTION_REDUCTION_PERIOD_DAYS)[number];

const PROCESS_GROUPS: ReductionProcessGroup[] = ['CUTTING', 'GRINDING'];

export type SelfInspectionReductionInsightsDto = {
  periodDays: number;
  generatedAt: string;
  secondsPerPiece: number | null;
  parts: ReductionPartInsightDto[];
};

export type ReductionPartKeyFilter = {
  fhincd: string;
  processGroup: ReductionProcessGroup;
  resourceCd: string;
};

function toLevel(template: {
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: number | null;
  selfInspectionSampleSize: number | null;
}): SelfInspectionReductionLevel {
  const mode = serializeSelfInspectionMode(template.selfInspectionMode);
  return { mode, fixedCount: mode === 'fixed_count' ? resolveTemplateFixedCount(template) : null };
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value == null ? null : value.toNumber();
}

const templateLevelSelect = {
  selfInspectionMode: true,
  selfInspectionFixedCount: true,
  selfInspectionSampleSize: true
} as const;

async function loadSessions(since: Date, key?: ReductionPartKeyFilter): Promise<ReductionSessionRow[]> {
  const rows = await prisma.selfInspectionSession.findMany({
    where: {
      invalidatedAt: null,
      completedAt: { gte: since },
      processGroup: { in: PROCESS_GROUPS },
      ...(key ? { fhincd: key.fhincd, processGroup: key.processGroup, resourceCd: key.resourceCd } : {})
    },
    orderBy: { completedAt: 'asc' },
    select: {
      id: true,
      fhincd: true,
      fhinmei: true,
      processGroup: true,
      resourceCd: true,
      machineName: true,
      plannedQuantity: true,
      completedAt: true,
      template: { select: templateLevelSelect },
      entries: {
        where: { persistenceStatus: 'CONFIRMED' },
        select: {
          createdAt: true,
          values: {
            select: {
              value: true,
              judgementResult: true,
              templateItem: {
                select: {
                  id: true,
                  sortOrder: true,
                  datumSurface: true,
                  measurementPoint: true,
                  measurementLabel: true,
                  displayMarker: true,
                  unit: true,
                  decimalPlaces: true,
                  nominalValue: true,
                  lowerLimit: true,
                  upperLimit: true,
                  depthMode: true,
                  valueKind: true
                }
              }
            }
          }
        }
      },
      inspectorEntries: {
        select: {
          values: { select: { templateItemId: true, operatorValueSnapshot: true, inspectorValue: true } }
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    fhincd: row.fhincd,
    fhinmei: row.fhinmei,
    processGroup: row.processGroup as ReductionProcessGroup,
    resourceCd: row.resourceCd,
    machineName: row.machineName,
    plannedQuantity: row.plannedQuantity,
    completedAt: row.completedAt!,
    level: toLevel(row.template),
    operatorValues: row.entries.flatMap((entry) =>
      entry.values.map((value) => ({
        item: {
          templateItemId: value.templateItem.id,
          sortOrder: value.templateItem.sortOrder,
          datumSurface: value.templateItem.datumSurface,
          measurementPoint: value.templateItem.measurementPoint,
          measurementLabel: value.templateItem.measurementLabel,
          displayMarker: value.templateItem.displayMarker,
          unit: value.templateItem.unit,
          decimalPlaces: value.templateItem.decimalPlaces,
          nominal: toNumber(value.templateItem.nominalValue),
          lower: toNumber(value.templateItem.lowerLimit),
          upper: toNumber(value.templateItem.upperLimit),
          depthMode: value.templateItem.depthMode,
          valueKind: value.templateItem.valueKind
        },
        value: toNumber(value.value),
        judgement: value.judgementResult,
        measuredAt: entry.createdAt
      }))
    ),
    inspectorPairs: row.inspectorEntries.flatMap((entry) =>
      entry.values.map((value) => ({
        templateItemId: value.templateItemId,
        operator: toNumber(value.operatorValueSnapshot),
        inspector: toNumber(value.inspectorValue)
      }))
    )
  }));
}

async function loadActiveTemplates(fhincds: string[]): Promise<Map<string, ReductionActiveTemplateRow>> {
  const rows = await prisma.partMeasurementTemplate.findMany({
    where: { fhincd: { in: fhincds }, isActive: true, templateScope: 'THREE_KEY', processGroup: { in: PROCESS_GROUPS } },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      fhincd: true,
      processGroup: true,
      resourceCd: true,
      version: true,
      createdAt: true,
      ...templateLevelSelect
    }
  });
  const map = new Map<string, ReductionActiveTemplateRow>();
  for (const row of rows) {
    const key = partKeyString(row);
    if (map.has(key)) continue;
    map.set(key, {
      id: row.id,
      fhincd: row.fhincd,
      processGroup: row.processGroup as ReductionProcessGroup,
      resourceCd: row.resourceCd,
      version: row.version,
      level: toLevel(row),
      createdAt: row.createdAt
    });
  }
  return map;
}

async function loadChangePoints(fhincds: string[]): Promise<Map<string, ReductionChangePointRow[]>> {
  const rows = await prisma.selfInspectionChangePoint.findMany({
    where: { fhincd: { in: fhincds } },
    orderBy: { occurredAt: 'asc' }
  });
  const map = new Map<string, ReductionChangePointRow[]>();
  for (const row of rows) {
    const key = partKeyString(row);
    const list = map.get(key) ?? [];
    list.push({
      id: row.id,
      fhincd: row.fhincd,
      processGroup: row.processGroup as ReductionProcessGroup,
      resourceCd: row.resourceCd,
      kind: row.kind,
      occurredAt: row.occurredAt,
      recordedByName: row.recordedByEmployeeNameSnapshot
    });
    map.set(key, list);
  }
  return map;
}

async function loadLatestDecisions(fhincds: string[]): Promise<Map<string, ReductionDecisionRow>> {
  const rows = await prisma.selfInspectionLevelDecision.findMany({
    where: { fhincd: { in: fhincds } },
    orderBy: { decidedAt: 'desc' }
  });
  const map = new Map<string, ReductionDecisionRow>();
  for (const row of rows) {
    const key = partKeyString(row);
    if (map.has(key)) continue;
    const toMode = serializeSelfInspectionMode(row.toMode);
    map.set(key, {
      id: row.id,
      fhincd: row.fhincd,
      processGroup: row.processGroup as ReductionProcessGroup,
      resourceCd: row.resourceCd,
      direction: row.direction,
      toLevel: { mode: toMode, fixedCount: toMode === 'fixed_count' ? row.toFixedCount : null },
      decidedAt: row.decidedAt,
      approverName: row.approverEmployeeNameSnapshot
    });
  }
  return map;
}

async function loadNonconformityCounts(fhincds: string[], since: Date): Promise<Map<string, number>> {
  const rows = await prisma.scawStfutekigoCurrent.groupBy({
    by: ['partNumber'],
    where: { partNumber: { in: fhincds }, discoveredOn: { gte: since } },
    _count: { _all: true }
  });
  return new Map(rows.map((row) => [row.partNumber ?? '', row._count._all]));
}

async function loadSecondsPerPiece(since: Date): Promise<number | null> {
  const rows = await prisma.selfInspectionMeasurementOperation.findMany({
    where: { mode: 'OPERATOR', operationKind: 'ENTRY_CONFIRMED', occurredAt: { gte: since } },
    select: { sessionId: true, occurredAt: true }
  });
  return medianSecondsPerPiece(rows);
}

export async function getSelfInspectionReductionInsights(input: {
  periodDays: number;
  now?: Date;
  key?: ReductionPartKeyFilter;
}): Promise<SelfInspectionReductionInsightsDto> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - input.periodDays * 24 * 60 * 60 * 1000);
  const sessions = await loadSessions(since, input.key);

  const sessionsByKey = new Map<string, ReductionSessionRow[]>();
  for (const session of sessions) {
    const key = partKeyString(session);
    const list = sessionsByKey.get(key) ?? [];
    list.push(session);
    sessionsByKey.set(key, list);
  }
  const fhincds = [...new Set(sessions.map((session) => session.fhincd))];

  const [templates, changePoints, decisions, nonconformities, secondsPerPiece] = await Promise.all([
    loadActiveTemplates(fhincds),
    loadChangePoints(fhincds),
    loadLatestDecisions(fhincds),
    loadNonconformityCounts(fhincds, since),
    input.key ? Promise.resolve(null) : loadSecondsPerPiece(since)
  ]);

  const parts = [...sessionsByKey.entries()].map(([key, partSessions]) =>
    buildReductionPartInsight({
      sessions: partSessions,
      activeTemplate: templates.get(key) ?? null,
      changePoints: changePoints.get(key) ?? [],
      latestDecision: decisions.get(key) ?? null,
      nonconformityCount: nonconformities.get(partSessions[0]!.fhincd) ?? 0,
      periodDays: input.periodDays
    })
  );
  parts.sort(
    (a, b) =>
      a.key.fhincd.localeCompare(b.key.fhincd, 'ja') ||
      a.key.processGroup.localeCompare(b.key.processGroup) ||
      a.key.resourceCd.localeCompare(b.key.resourceCd, 'ja')
  );

  return { periodDays: input.periodDays, generatedAt: now.toISOString(), secondsPerPiece, parts };
}
