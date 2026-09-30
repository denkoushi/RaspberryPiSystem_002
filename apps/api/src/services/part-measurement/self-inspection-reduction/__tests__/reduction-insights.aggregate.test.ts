import { describe, expect, it } from 'vitest';

import {
  buildReductionPartInsight,
  medianSecondsPerPiece,
  type ReductionItemInfo,
  type ReductionSessionRow
} from '../reduction-insights.aggregate.js';
import {
  REDUCTION_CPK_CAP,
  computeCpk,
  countTrailingPasses,
  detectDrift,
  measurementGapRatio,
  stableTemplateItemKey
} from '../reduction-stats.js';

const limits = { lower: 9.9, upper: 10.1 };

describe('reduction stats', () => {
  it('computes Cpk from the nearest limit', () => {
    const cpk = computeCpk([10.0, 10.02, 9.98, 10.01, 9.99], limits)!;
    expect(cpk).toBeGreaterThan(1.67);
    expect(computeCpk([10.08, 10.09, 10.1, 10.07], limits)!).toBeLessThan(1);
    expect(computeCpk([10], limits)).toBeNull();
    expect(computeCpk([10, 10, 10], limits)).toBe(REDUCTION_CPK_CAP);
  });

  it('detects drift only with enough values and a clear shift', () => {
    const stable = Array.from({ length: 30 }, (_, i) => 10 + (i % 2 ? 0.005 : -0.005));
    expect(detectDrift(stable, limits)).toBe(false);
    const shifted = [...Array.from({ length: 20 }, () => 10), ...Array.from({ length: 10 }, () => 10.04)];
    expect(detectDrift(shifted, limits)).toBe(true);
    expect(detectDrift(shifted.slice(-15), limits)).toBe(false);
  });

  it('counts trailing passes', () => {
    expect(countTrailingPasses([true, false, true, true])).toBe(2);
    expect(countTrailingPasses([true, true, false])).toBe(0);
    expect(countTrailingPasses([])).toBe(0);
  });

  it('expresses the operator/inspector gap as a share of the tolerance width', () => {
    expect(measurementGapRatio([{ operator: 10, inspector: 10.02 }], limits)).toBeCloseTo(0.1);
    expect(measurementGapRatio([], limits)).toBeNull();
  });

  it('matches items across template versions by their text', () => {
    expect(
      stableTemplateItemKey({ datumSurface: ' A ', measurementPoint: '外径  φ32', measurementLabel: '外径' })
    ).toBe('A|外径 φ32|外径');
  });
});

function item(id: string, overrides: Partial<ReductionItemInfo> = {}): ReductionItemInfo {
  return {
    templateItemId: id,
    sortOrder: 0,
    datumSurface: 'A',
    measurementPoint: '外径',
    measurementLabel: '外径',
    displayMarker: '1',
    unit: 'mm',
    decimalPlaces: 3,
    nominal: 10,
    lower: 9.9,
    upper: 10.1,
    depthMode: 'MEASURED',
    valueKind: 'NUMERIC',
    ...overrides
  };
}

function session(index: number, values: number[], templateItem = item('item-v1')): ReductionSessionRow {
  const completedAt = new Date(Date.UTC(2026, 8, 1 + index));
  return {
    id: `s${index}`,
    fhincd: 'MD00412163',
    fhinmei: 'シャフト',
    processGroup: 'CUTTING',
    resourceCd: '581',
    machineName: 'NL2500',
    plannedQuantity: 40,
    completedAt,
    level: { mode: 'full', fixedCount: null },
    operatorValues: values.map((value, i) => ({
      item: templateItem,
      value,
      judgement: null,
      measuredAt: new Date(completedAt.getTime() - (values.length - i) * 1000)
    })),
    inspectorPairs: [{ templateItemId: templateItem.templateItemId, operator: values[0] ?? null, inspector: (values[0] ?? 0) + 0.004 }]
  };
}

describe('buildReductionPartInsight', () => {
  const base = { activeTemplate: null, changePoints: [], latestDecision: null, nonconformityCount: 0, periodDays: 90 };

  it('builds metrics for one part key across template versions', () => {
    const sessions = [
      session(0, [10.0, 10.01]),
      session(1, [9.99, 10.0], item('item-v2')),
      session(2, [10.02, 9.98], item('item-v2'))
    ];
    const insight = buildReductionPartInsight({ ...base, sessions });
    expect(insight.items).toHaveLength(1);
    expect(insight.items[0]!.valueCount).toBe(6);
    expect(insight.metrics).toMatchObject({
      lotSize: 40,
      evaluable: true,
      sampleCount: 6,
      consecutivePassLots: 3,
      consecutivePassLotsSinceChangePoint: null,
      outOfToleranceCount: 0
    });
    expect(insight.metrics.measurementGapRatio).toBeCloseTo(0.02);
    expect(insight.lotsPerMonth).toBe(1);
  });

  it('marks lots with out-of-spec values as failed and breaks the streak', () => {
    const insight = buildReductionPartInsight({
      ...base,
      sessions: [session(0, [10]), session(1, [10.2]), session(2, [10])]
    });
    expect(insight.recentLots.map((lot) => lot.pass)).toEqual([true, false, true]);
    expect(insight.metrics).toMatchObject({ consecutivePassLots: 1, outOfToleranceCount: 1 });
  });

  it('uses only values measured against the latest limits', () => {
    const insight = buildReductionPartInsight({
      ...base,
      sessions: [session(0, [10.0]), session(1, [10.0, 10.01], item('item-v2', { lower: 9.95, upper: 10.05 }))]
    });
    expect(insight.items[0]).toMatchObject({ lower: 9.95, upper: 10.05, valueCount: 2 });
  });

  it('counts the streak from the latest change point', () => {
    const insight = buildReductionPartInsight({
      ...base,
      sessions: [session(0, [10]), session(1, [10]), session(2, [10])],
      changePoints: [
        {
          id: 'cp1',
          fhincd: 'MD00412163',
          processGroup: 'CUTTING',
          resourceCd: '581',
          kind: 'TOOL_CHANGE',
          occurredAt: new Date(Date.UTC(2026, 8, 2, 12)),
          recordedByName: '社員A'
        }
      ]
    });
    expect(insight.metrics.consecutivePassLotsSinceChangePoint).toBe(1);
    expect(insight.changePoints[0]).toMatchObject({ kind: 'TOOL_CHANGE', recordedByName: '社員A' });
  });

  it('is not evaluable when no numeric item has both limits', () => {
    const insight = buildReductionPartInsight({
      ...base,
      sessions: [session(0, [10], item('x', { lower: null }))]
    });
    expect(insight.metrics).toMatchObject({ evaluable: false, worstCpk: null, sampleCount: 0 });
  });

  it('flags a decision as awaiting revision until the template is revised', () => {
    const decidedAt = new Date(Date.UTC(2026, 8, 20));
    const decision = {
      id: 'd1',
      fhincd: 'MD00412163',
      processGroup: 'CUTTING' as const,
      resourceCd: '581',
      direction: 'REDUCE' as const,
      toLevel: { mode: 'fixed_count' as const, fixedCount: 5 },
      decidedAt,
      approverName: '社員A'
    };
    const template = {
      id: 't1',
      fhincd: 'MD00412163',
      processGroup: 'CUTTING' as const,
      resourceCd: '581',
      version: 3,
      level: { mode: 'full' as const, fixedCount: null },
      createdAt: new Date(Date.UTC(2026, 8, 1))
    };
    const waiting = buildReductionPartInsight({
      ...base,
      sessions: [session(0, [10])],
      activeTemplate: template,
      latestDecision: decision
    });
    expect(waiting.latestDecision?.awaitingRevision).toBe(true);
    const revised = buildReductionPartInsight({
      ...base,
      sessions: [session(0, [10])],
      activeTemplate: { ...template, createdAt: new Date(Date.UTC(2026, 8, 21)) },
      latestDecision: decision
    });
    expect(revised.latestDecision?.awaitingRevision).toBe(false);
  });
});

describe('medianSecondsPerPiece', () => {
  it('uses intervals between confirmations inside each session', () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 8, 1, 8, 0, seconds));
    expect(
      medianSecondsPerPiece([
        { sessionId: 'a', occurredAt: at(0) },
        { sessionId: 'a', occurredAt: at(10) },
        { sessionId: 'a', occurredAt: at(30) },
        { sessionId: 'b', occurredAt: at(5) },
        { sessionId: 'b', occurredAt: at(20) }
      ])
    ).toBe(15);
    expect(medianSecondsPerPiece([])).toBeNull();
  });
});
