import { DEFAULT_SELF_INSPECTION_REDUCTION_POLICY } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { buildReductionFindings } from './selfInspectionReductionFindings';
import { buildReductionRows } from './selfInspectionReductionViewModel';

import type { SelfInspectionReductionItem, SelfInspectionReductionPart } from '../../../api/client';

const policy = DEFAULT_SELF_INSPECTION_REDUCTION_POLICY;
const options = { periodDays: 90, savingsHours: 4.2 };

function part(
  fhincd: string,
  metrics: Partial<SelfInspectionReductionPart['metrics']> = {},
  rest: Partial<SelfInspectionReductionPart> = {}
): SelfInspectionReductionPart {
  return {
    key: { fhincd, processGroup: 'cutting', resourceCd: '581' },
    fhinmei: 'シャフト',
    machineName: null,
    templateId: null,
    templateVersion: null,
    lotCount: 12,
    lotsPerMonth: 10,
    recentLots: [],
    metrics: {
      level: { mode: 'full', fixedCount: null },
      lotSize: 40,
      evaluable: true,
      worstCpk: 2,
      sampleCount: 100,
      consecutivePassLots: 12,
      consecutivePassLotsSinceChangePoint: null,
      drift: false,
      measurementGapRatio: 0.03,
      outOfToleranceCount: 0,
      nonconformityCount: 0,
      ...metrics
    },
    items: [],
    worstItemKey: null,
    judgementFailCount: 0,
    changePoints: [],
    latestDecision: null,
    ...rest
  };
}

/** 公差 9.9〜10.1 の項目。values は古い順。 */
function item(values: number[]): SelfInspectionReductionItem {
  return {
    key: 'A|外径|外径',
    label: '外径',
    point: '外径',
    marker: '1',
    unit: 'mm',
    decimalPlaces: 3,
    nominal: 10,
    lower: 9.9,
    upper: 10.1,
    valueCount: values.length,
    mean: null,
    standardDeviation: null,
    cpk: null,
    drift: false,
    outOfToleranceCount: 0,
    values: values.map((value, index) => ({ value, measuredAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString() }))
  };
}

function findings(parts: SelfInspectionReductionPart[], overrides: Partial<typeof options> = {}) {
  return buildReductionFindings(buildReductionRows(parts, policy), policy, { ...options, ...overrides });
}

describe('buildReductionFindings', () => {
  it('says the trend cannot be told while most parts lack data, and names the part closest to enough data', () => {
    const result = findings([
      part('A-FAR', { sampleCount: 6 }),
      part('B-NEAR', { sampleCount: 22 }),
      part('C-ENOUGH', { worstCpk: 1.45 })
    ]);
    expect(result.overall).toMatchObject({ kind: 'shortage', text: '3件中2件がデータ不足。傾向はまだ言えない' });
    expect(result.overall.rowIds).toHaveLength(2);
    // 22個を90日で測ったので、あと8個は約33日。
    expect(result.focus).toMatchObject({
      kind: 'almost',
      fhincd: 'B-NEAR',
      text: 'あと8個で減らせる'
    });
  });

  it('falls back to the data shortage line when no part is one step away', () => {
    const result = findings([part('A-FAR', { sampleCount: 6, worstCpk: 1.2 }), part('B-NEAR', { sampleCount: 22, worstCpk: 1.2 })]);
    expect(result.focus).toMatchObject({ kind: 'shortage', fhincd: 'B-NEAR', text: '：あと8個（約5週間）', moreCount: 1 });
    expect(result.focus.rowIds[0]).toBe('B-NEAR/cutting/581');
  });

  it('puts a part to restore before everything else', () => {
    const result = findings([
      part('A-REDUCE'),
      part('B-ALMOST', { consecutivePassLots: 8 }),
      part('C-RESTORE', { outOfToleranceCount: 2 })
    ]);
    expect(result.focus).toMatchObject({ kind: 'restore', fhincd: 'C-RESTORE', text: '規格外2件。原因を確認', moreCount: 0 });
    expect(result.overall).toMatchObject({ kind: 'trend', text: '減らせる1件、承認で月 −4.2時間' });
  });

  it('names the part with the fewest lots left when nothing is wrong', () => {
    const result = findings([
      part('A-REDUCE'),
      part('B-LOTS', { consecutivePassLots: 8 }),
      part('C-CPK', { worstCpk: 1.45 }),
      part('D-SINGLE', { consecutivePassLots: 8, level: { mode: 'single', fixedCount: null } })
    ]);
    expect(result.focus).toMatchObject({ kind: 'almost', fhincd: 'B-LOTS', text: 'あと2ロットで減らせる', moreCount: 1 });
  });

  it('flags a passing part only when two signs agree', () => {
    const stable = Array.from({ length: 20 }, (_, i) => 10 + (i % 2 ? 0.01 : -0.01));
    const worse = Array.from({ length: 20 }, (_, i) => 10.03 + (i % 2 ? 0.03 : -0.03));
    const falling = item([...stable, ...worse]);
    const oneSign = findings([
      part('A-FALLING', { worstCpk: 1.7 }, { items: [falling], worstItemKey: falling.key })
    ]);
    expect(oneSign.focus.kind).not.toBe('suspicious');

    const twoSigns = findings([
      part('A-FALLING', { worstCpk: 1.7, drift: true }, { items: [falling], worstItemKey: falling.key })
    ]);
    expect(twoSigns.focus).toMatchObject({ kind: 'suspicious', fhincd: 'A-FALLING' });
    expect(twoSigns.focus.text).toMatch(/^合格だがCpk \d\.\d→\d\.\d$/);
  });

  it('does not flag a part with fewer than 20 values', () => {
    const result = findings([part('A-FEW', { sampleCount: 19, drift: true, measurementGapRatio: 0.2 })]);
    expect(result.focus.kind).not.toBe('suspicious');
  });

  it('tells the overall trend only with three comparable parts', () => {
    const previous = { worstCpk: 1.5, sampleCount: 60, lotCount: 8 };
    const two = findings([
      part('A', { worstCpk: 1.45 }, { previousPeriod: previous }),
      part('B', { worstCpk: 1.45 }, { previousPeriod: previous })
    ]);
    expect(two.overall.text).not.toContain('全体は');

    const three = findings([
      part('A', { worstCpk: 1.9, drift: true }, { previousPeriod: previous }),
      part('B', { worstCpk: 1.8, drift: true }, { previousPeriod: previous }),
      part('C', { worstCpk: 1.8, measurementGapRatio: null }, { previousPeriod: previous })
    ]);
    expect(three.overall).toMatchObject({ kind: 'trend', icon: 'up', text: '全体は上向き。足止めの最多はずれの傾向 2件' });
    expect(three.overall.rowIds).toHaveLength(2);
  });

  it('points at a resource whose parts all fell', () => {
    const result = findings([
      part('A', { worstCpk: 1.4 }, { previousPeriod: { worstCpk: 1.9, sampleCount: 60, lotCount: 8 } }),
      part('B', { worstCpk: 1.5 }, { previousPeriod: { worstCpk: 1.8, sampleCount: 60, lotCount: 8 } }),
      part('C', { worstCpk: 2 }, { key: { fhincd: 'C', processGroup: 'grinding', resourceCd: '612' }, previousPeriod: { worstCpk: 2, sampleCount: 60, lotCount: 8 } })
    ]);
    expect(result.overall).toMatchObject({ tone: 'warn', text: '全体は下向き。切削 581 の2品番がそろって下向き' });
  });

  it('has a quiet line when nothing needs attention', () => {
    const result = findings([part('A', {}, { latestDecision: { id: 'd', direction: 'reduce', toLevel: { mode: 'fixed_count', fixedCount: 5 }, decidedAt: '2026-09-30T00:00:00.000Z', approverName: '社員A', awaitingRevision: true } })]);
    expect(result.focus).toMatchObject({ kind: 'calm', rowIds: [] });
    expect(result.overall.text).toBe('承認済み1件が改版待ち');
    expect(findings([]).overall.kind).toBe('empty');
  });
});
