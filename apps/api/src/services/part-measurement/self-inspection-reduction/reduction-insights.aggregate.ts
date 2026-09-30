import type {
  SelfInspectionReductionLevel,
  SelfInspectionReductionMetrics
} from '@raspi-system/shared-types';

import {
  computeCpk,
  countTrailingPasses,
  detectDrift,
  isOutOfTolerance,
  mean,
  measurementGapRatio,
  median,
  sampleStandardDeviation,
  stableTemplateItemKey,
  type ToleranceLimits
} from './reduction-stats.js';

/** 画面に返す測定値の最大個数（直近分）。統計は期間内の全件で計算する。 */
export const REDUCTION_RESPONSE_VALUE_LIMIT = 60;
/** 画面に返すロット合否の最大個数（直近分）。 */
export const REDUCTION_RECENT_LOT_LIMIT = 20;

export type ReductionProcessGroup = 'CUTTING' | 'GRINDING';
export type ReductionProcessGroupDto = 'cutting' | 'grinding';

export type ReductionItemInfo = {
  templateItemId: string;
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  displayMarker: string | null;
  unit: string | null;
  decimalPlaces: number;
  nominal: number | null;
  lower: number | null;
  upper: number | null;
  depthMode: string;
  valueKind: string;
};

export type ReductionSessionRow = {
  id: string;
  fhincd: string;
  fhinmei: string;
  processGroup: ReductionProcessGroup;
  resourceCd: string;
  machineName: string | null;
  plannedQuantity: number;
  completedAt: Date;
  level: SelfInspectionReductionLevel;
  operatorValues: Array<{
    item: ReductionItemInfo;
    value: number | null;
    judgement: 'PASS' | 'FAIL' | null;
    measuredAt: Date;
  }>;
  inspectorPairs: Array<{ templateItemId: string; operator: number | null; inspector: number | null }>;
};

export type ReductionActiveTemplateRow = {
  id: string;
  fhincd: string;
  processGroup: ReductionProcessGroup;
  resourceCd: string;
  version: number;
  level: SelfInspectionReductionLevel;
  createdAt: Date;
};

export type ReductionChangePointRow = {
  id: string;
  fhincd: string;
  processGroup: ReductionProcessGroup;
  resourceCd: string;
  kind: string;
  occurredAt: Date;
  recordedByName: string;
};

export type ReductionDecisionRow = {
  id: string;
  fhincd: string;
  processGroup: ReductionProcessGroup;
  resourceCd: string;
  direction: 'REDUCE' | 'RESTORE';
  toLevel: SelfInspectionReductionLevel;
  decidedAt: Date;
  approverName: string;
};

export type ReductionPartKeyDto = {
  fhincd: string;
  processGroup: ReductionProcessGroupDto;
  resourceCd: string;
};

export type ReductionItemDto = {
  key: string;
  label: string;
  point: string;
  marker: string | null;
  unit: string | null;
  decimalPlaces: number;
  nominal: number | null;
  lower: number;
  upper: number;
  valueCount: number;
  mean: number | null;
  standardDeviation: number | null;
  cpk: number | null;
  drift: boolean;
  outOfToleranceCount: number;
  values: Array<{ value: number; measuredAt: string }>;
};

export type ReductionPartInsightDto = {
  key: ReductionPartKeyDto;
  fhinmei: string;
  machineName: string | null;
  templateId: string | null;
  templateVersion: number | null;
  lotCount: number;
  lotsPerMonth: number;
  recentLots: Array<{ pass: boolean; completedAt: string }>;
  metrics: SelfInspectionReductionMetrics;
  items: ReductionItemDto[];
  worstItemKey: string | null;
  judgementFailCount: number;
  changePoints: Array<{ id: string; kind: string; occurredAt: string; recordedByName: string }>;
  latestDecision: {
    id: string;
    direction: 'reduce' | 'restore';
    toLevel: SelfInspectionReductionLevel;
    decidedAt: string;
    approverName: string;
    /** 承認後にまだテンプレートが改版されていない。 */
    awaitingRevision: boolean;
  } | null;
};

export function partKeyString(key: { fhincd: string; processGroup: string; resourceCd: string }): string {
  return `${key.fhincd}\u0000${key.processGroup}\u0000${key.resourceCd}`;
}

function toDtoProcessGroup(group: ReductionProcessGroup): ReductionProcessGroupDto {
  return group === 'GRINDING' ? 'grinding' : 'cutting';
}

function limitsOf(item: ReductionItemInfo): ToleranceLimits | null {
  if (item.valueKind !== 'NUMERIC') return null;
  if (item.depthMode.toUpperCase() === 'THROUGH') return null;
  if (item.lower == null || item.upper == null) return null;
  const lower = Math.min(item.lower, item.upper);
  const upper = Math.max(item.lower, item.upper);
  return upper > lower ? { lower, upper } : null;
}

type ItemAccumulator = {
  key: string;
  item: ReductionItemInfo;
  limits: ToleranceLimits;
  points: Array<{ value: number; measuredAt: Date }>;
  templateItemIds: Set<string>;
};

/**
 * 1つの品番×工程×資源について、期間内の完了ロットから指標を作る。
 * sessions は完了時刻の古い順であること。
 */
export function buildReductionPartInsight(input: {
  sessions: readonly ReductionSessionRow[];
  activeTemplate: ReductionActiveTemplateRow | null;
  changePoints: readonly ReductionChangePointRow[];
  latestDecision: ReductionDecisionRow | null;
  nonconformityCount: number;
  periodDays: number;
}): ReductionPartInsightDto {
  const { sessions } = input;
  const latest = sessions[sessions.length - 1]!;

  // 版をまたいで同じ項目を束ねる。公差が変わったら最新の公差で測った値だけ使う。
  const latestLimitsByKey = new Map<string, { item: ReductionItemInfo; limits: ToleranceLimits }>();
  for (const session of sessions) {
    for (const row of session.operatorValues) {
      const limits = limitsOf(row.item);
      if (!limits) continue;
      latestLimitsByKey.set(stableTemplateItemKey(row.item), { item: row.item, limits });
    }
  }

  const accumulators = new Map<string, ItemAccumulator>();
  const lotPasses: boolean[] = [];
  let outOfToleranceCount = 0;
  let judgementFailCount = 0;
  const gapPairsByKey = new Map<string, Array<{ operator: number; inspector: number }>>();

  for (const session of sessions) {
    let pass = true;
    const keyByTemplateItemId = new Map<string, string>();
    for (const row of session.operatorValues) {
      if (row.judgement === 'FAIL') {
        pass = false;
        judgementFailCount += 1;
      }
      const limits = limitsOf(row.item);
      if (!limits || row.value == null) continue;
      if (isOutOfTolerance(row.value, limits)) {
        pass = false;
        outOfToleranceCount += 1;
      }
      const key = stableTemplateItemKey(row.item);
      const latestForKey = latestLimitsByKey.get(key)!;
      if (latestForKey.limits.lower !== limits.lower || latestForKey.limits.upper !== limits.upper) continue;
      keyByTemplateItemId.set(row.item.templateItemId, key);
      let acc = accumulators.get(key);
      if (!acc) {
        acc = { key, item: latestForKey.item, limits, points: [], templateItemIds: new Set() };
        accumulators.set(key, acc);
      }
      acc.templateItemIds.add(row.item.templateItemId);
      acc.points.push({ value: row.value, measuredAt: row.measuredAt });
    }
    for (const pair of session.inspectorPairs) {
      const key = keyByTemplateItemId.get(pair.templateItemId);
      if (!key || pair.operator == null || pair.inspector == null) continue;
      const list = gapPairsByKey.get(key) ?? [];
      list.push({ operator: pair.operator, inspector: pair.inspector });
      gapPairsByKey.set(key, list);
    }
    lotPasses.push(pass);
  }

  const items: ReductionItemDto[] = [...accumulators.values()]
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder)
    .map((acc) => {
      const points = [...acc.points].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
      const values = points.map((point) => point.value);
      return {
        key: acc.key,
        label: acc.item.measurementLabel,
        point: acc.item.measurementPoint,
        marker: acc.item.displayMarker,
        unit: acc.item.unit,
        decimalPlaces: acc.item.decimalPlaces,
        nominal: acc.item.nominal,
        lower: acc.limits.lower,
        upper: acc.limits.upper,
        valueCount: values.length,
        mean: mean(values),
        standardDeviation: sampleStandardDeviation(values),
        cpk: computeCpk(values, acc.limits),
        drift: detectDrift(values, acc.limits),
        outOfToleranceCount: values.filter((value) => isOutOfTolerance(value, acc.limits)).length,
        values: points
          .slice(-REDUCTION_RESPONSE_VALUE_LIMIT)
          .map((point) => ({ value: point.value, measuredAt: point.measuredAt.toISOString() }))
      };
    });

  const withCpk = items.filter((item) => item.cpk != null);
  const worst = withCpk.length
    ? withCpk.reduce((min, item) => (item.cpk! < min.cpk! ? item : min))
    : (items[0] ?? null);

  const gapRatios = items
    .map((item) => measurementGapRatio(gapPairsByKey.get(item.key) ?? [], item))
    .filter((ratio): ratio is number => ratio != null);

  const changePoints = [...input.changePoints].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const lastChangePoint = changePoints[changePoints.length - 1] ?? null;
  const consecutivePassLotsSinceChangePoint = lastChangePoint
    ? countTrailingPasses(
        sessions
          .map((session, index) => ({ session, pass: lotPasses[index]! }))
          .filter(({ session }) => session.completedAt.getTime() > lastChangePoint.occurredAt.getTime())
          .map(({ pass }) => pass)
      )
    : null;

  const level = input.activeTemplate?.level ?? latest.level;
  const lotSize = Math.max(Math.round(median(sessions.map((session) => session.plannedQuantity)) ?? 1), 1);

  const metrics: SelfInspectionReductionMetrics = {
    level,
    lotSize,
    evaluable: items.length > 0,
    worstCpk: worst?.cpk ?? null,
    sampleCount: items.length ? Math.min(...items.map((item) => item.valueCount)) : 0,
    consecutivePassLots: countTrailingPasses(lotPasses),
    consecutivePassLotsSinceChangePoint,
    drift: items.some((item) => item.drift),
    measurementGapRatio: gapRatios.length ? Math.max(...gapRatios) : null,
    outOfToleranceCount,
    nonconformityCount: input.nonconformityCount
  };

  const decision = input.latestDecision;
  return {
    key: {
      fhincd: latest.fhincd,
      processGroup: toDtoProcessGroup(latest.processGroup),
      resourceCd: latest.resourceCd
    },
    fhinmei: latest.fhinmei,
    machineName: latest.machineName,
    templateId: input.activeTemplate?.id ?? null,
    templateVersion: input.activeTemplate?.version ?? null,
    lotCount: sessions.length,
    lotsPerMonth: (sessions.length / Math.max(input.periodDays, 1)) * 30,
    recentLots: sessions
      .map((session, index) => ({ pass: lotPasses[index]!, completedAt: session.completedAt.toISOString() }))
      .slice(-REDUCTION_RECENT_LOT_LIMIT),
    metrics,
    items,
    worstItemKey: worst?.key ?? null,
    judgementFailCount,
    changePoints: changePoints.map((point) => ({
      id: point.id,
      kind: point.kind,
      occurredAt: point.occurredAt.toISOString(),
      recordedByName: point.recordedByName
    })),
    latestDecision: decision
      ? {
          id: decision.id,
          direction: decision.direction === 'RESTORE' ? 'restore' : 'reduce',
          toLevel: decision.toLevel,
          decidedAt: decision.decidedAt.toISOString(),
          approverName: decision.approverName,
          awaitingRevision:
            !input.activeTemplate || input.activeTemplate.createdAt.getTime() < decision.decidedAt.getTime()
        }
      : null
  };
}

/** 作業者の確定操作の間隔（秒）の中央値。1個あたりの入力時間の目安に使う。 */
export const REDUCTION_PIECE_INTERVAL_RANGE_SECONDS = { min: 1, max: 1800 } as const;

export function medianSecondsPerPiece(
  confirmations: ReadonlyArray<{ sessionId: string; occurredAt: Date }>
): number | null {
  const bySession = new Map<string, number[]>();
  for (const row of confirmations) {
    const list = bySession.get(row.sessionId) ?? [];
    list.push(row.occurredAt.getTime());
    bySession.set(row.sessionId, list);
  }
  const intervals: number[] = [];
  for (const times of bySession.values()) {
    times.sort((a, b) => a - b);
    for (let index = 1; index < times.length; index += 1) {
      const seconds = (times[index]! - times[index - 1]!) / 1000;
      if (
        seconds >= REDUCTION_PIECE_INTERVAL_RANGE_SECONDS.min &&
        seconds <= REDUCTION_PIECE_INTERVAL_RANGE_SECONDS.max
      ) {
        intervals.push(seconds);
      }
    }
  }
  return median(intervals);
}
