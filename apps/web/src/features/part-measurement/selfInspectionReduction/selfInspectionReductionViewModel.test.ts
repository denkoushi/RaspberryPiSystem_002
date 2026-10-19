import { DEFAULT_SELF_INSPECTION_REDUCTION_POLICY } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import {
  buildReductionRows,
  countReductionVerdicts,
  cpkMargin,
  estimateMonthlySavings,
  filterReductionRows
} from './selfInspectionReductionViewModel';

import type { SelfInspectionReductionPart } from '../../../api/client';

function part(
  fhincd: string,
  overrides: Partial<SelfInspectionReductionPart['metrics']> = {},
  processGroup: 'cutting' | 'grinding' = 'cutting'
): SelfInspectionReductionPart {
  return {
    key: { fhincd, processGroup, resourceCd: '581' },
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
      ...overrides
    },
    items: [],
    worstItemKey: null,
    judgementFailCount: 0,
    changePoints: [],
    latestDecision: null
  };
}

describe('self-inspection reduction view model', () => {
  const parts = [
    part('A-REDUCE'),
    part('B-ALMOST', { worstCpk: 1.45 }),
    part('C-RESTORE', { outOfToleranceCount: 1 }),
    part('D-KEEP', { drift: true }, 'grinding')
  ];

  it('orders rows so parts to restore and reduce come first', () => {
    const rows = buildReductionRows(parts, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY);
    expect(rows.map((row) => row.judgement.verdict)).toEqual(['restore', 'reduce', 'almost', 'keep']);
    expect(countReductionVerdicts(rows)).toMatchObject({ reduce: 1, almost: 1, keep: 1, restore: 1 });
  });

  it('switches verdicts with the Cpk threshold without refetching', () => {
    const rows = buildReductionRows(parts, { ...DEFAULT_SELF_INSPECTION_REDUCTION_POLICY, cpkThreshold: 1.33 });
    expect(countReductionVerdicts(rows).reduce).toBe(2);
  });

  it('filters by verdict, process and text', () => {
    const rows = buildReductionRows(parts, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY);
    expect(filterReductionRows(rows, { verdict: 'reduce', process: 'all', query: '' })).toHaveLength(1);
    expect(filterReductionRows(rows, { verdict: null, process: 'grinding', query: '' })[0]?.part.key.fhincd).toBe('D-KEEP');
    expect(filterReductionRows(rows, { verdict: null, process: 'all', query: 'almost' })).toHaveLength(1);
  });

  it('estimates the pieces and hours saved by stepping reducible parts down', () => {
    const rows = buildReductionRows(parts, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY);
    // 全数40個 → 指定数5個、月10ロット: 350個、15秒/個
    expect(estimateMonthlySavings(rows, 15)).toEqual({ pieces: 350, hours: 350 * 15 / 3600 });
    expect(estimateMonthlySavings(rows, null).hours).toBeNull();
  });

  it('describes Cpk margin in plain words', () => {
    expect(cpkMargin(1.8).label).toBe('たっぷり');
    expect(cpkMargin(1.4).label).toBe('あり');
    expect(cpkMargin(1.1).label).toBe('ぎりぎり');
    expect(cpkMargin(0.8).label).toBe('足りない');
    expect(cpkMargin(null).label).toBe('—');
  });
});
