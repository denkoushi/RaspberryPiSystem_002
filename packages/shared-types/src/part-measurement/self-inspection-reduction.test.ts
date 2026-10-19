import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SELF_INSPECTION_REDUCTION_POLICY,
  heavierSelfInspectionLevel,
  judgeSelfInspectionReduction,
  lighterSelfInspectionLevel,
  selfInspectionPiecesPerLot,
  type SelfInspectionReductionMetrics
} from './self-inspection-reduction.js';

const capable: SelfInspectionReductionMetrics = {
  level: { mode: 'full', fixedCount: null },
  lotSize: 40,
  evaluable: true,
  worstCpk: 2.1,
  sampleCount: 120,
  consecutivePassLots: 14,
  consecutivePassLotsSinceChangePoint: null,
  drift: false,
  measurementGapRatio: 0.04,
  outOfToleranceCount: 0,
  nonconformityCount: 0
};

describe('self-inspection reduction ladder', () => {
  it('steps full down to the suggested fixed count, then first/last, then single', () => {
    expect(lighterSelfInspectionLevel({ mode: 'full', fixedCount: null }, 40)).toEqual({
      mode: 'fixed_count',
      fixedCount: 5
    });
    expect(lighterSelfInspectionLevel({ mode: 'full', fixedCount: null }, 4)).toEqual({
      mode: 'first_last',
      fixedCount: null
    });
    expect(lighterSelfInspectionLevel({ mode: 'fixed_count', fixedCount: 3 }, 40)?.mode).toBe('first_last');
    expect(lighterSelfInspectionLevel({ mode: 'fixed_count', fixedCount: 2 }, 40)?.mode).toBe('single');
    expect(lighterSelfInspectionLevel({ mode: 'single', fixedCount: null }, 40)).toBeNull();
  });

  it('steps back one level at a time and stops at full', () => {
    expect(heavierSelfInspectionLevel({ mode: 'single', fixedCount: null })?.mode).toBe('first_last');
    expect(heavierSelfInspectionLevel({ mode: 'fixed_count', fixedCount: 5 })?.mode).toBe('full');
    expect(heavierSelfInspectionLevel({ mode: 'full', fixedCount: null })).toBeNull();
  });

  it('counts pieces per lot without exceeding the lot size', () => {
    expect(selfInspectionPiecesPerLot({ mode: 'full', fixedCount: null }, 40)).toBe(40);
    expect(selfInspectionPiecesPerLot({ mode: 'fixed_count', fixedCount: 5 }, 3)).toBe(3);
    expect(selfInspectionPiecesPerLot({ mode: 'first_last', fixedCount: null }, 40)).toBe(2);
    expect(selfInspectionPiecesPerLot({ mode: 'single', fixedCount: null }, 40)).toBe(1);
  });
});

describe('judgeSelfInspectionReduction', () => {
  it('proposes one lighter level when every condition is met', () => {
    const result = judgeSelfInspectionReduction(capable, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY);
    expect(result.verdict).toBe('reduce');
    expect(result.target).toEqual({ mode: 'fixed_count', fixedCount: 5 });
  });

  it('uses the switchable Cpk threshold', () => {
    const metrics = { ...capable, worstCpk: 1.45 };
    expect(judgeSelfInspectionReduction(metrics, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY).verdict).toBe('almost');
    expect(
      judgeSelfInspectionReduction(metrics, { ...DEFAULT_SELF_INSPECTION_REDUCTION_POLICY, cpkThreshold: 1.33 }).verdict
    ).toBe('reduce');
  });

  it('keeps the level when Cpk is below 1.33 with enough data', () => {
    const result = judgeSelfInspectionReduction({ ...capable, worstCpk: 1.2 }, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY);
    expect(result.verdict).toBe('keep');
    expect(result.checks.cpk).toBe('ng');
  });

  it('treats Cpk as a reference only while the sample is short', () => {
    const result = judgeSelfInspectionReduction(
      { ...capable, sampleCount: 12, worstCpk: 0.8 },
      DEFAULT_SELF_INSPECTION_REDUCTION_POLICY
    );
    expect(result.verdict).toBe('almost');
    expect(result.checks.cpk).toBe('hold');
  });

  it('restores one heavier level on out-of-spec values or downstream nonconformities', () => {
    const level = { mode: 'first_last' as const, fixedCount: null };
    expect(
      judgeSelfInspectionReduction({ ...capable, level, outOfToleranceCount: 1 }, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY)
    ).toMatchObject({ verdict: 'restore', target: { mode: 'fixed_count', fixedCount: 5 } });
    expect(
      judgeSelfInspectionReduction({ ...capable, nonconformityCount: 1 }, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY).verdict
    ).toBe('restore');
    expect(
      judgeSelfInspectionReduction({ ...capable, worstCpk: 0.9 }, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY).verdict
    ).toBe('restore');
  });

  it('counts the streak from the latest change point only when the setting is on', () => {
    const metrics = { ...capable, consecutivePassLotsSinceChangePoint: 3 };
    const on = judgeSelfInspectionReduction(metrics, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY);
    expect(on).toMatchObject({ verdict: 'almost', effectiveConsecutivePassLots: 3 });
    const off = judgeSelfInspectionReduction(metrics, {
      ...DEFAULT_SELF_INSPECTION_REDUCTION_POLICY,
      resetStreakOnChangePoint: false
    });
    expect(off).toMatchObject({ verdict: 'reduce', effectiveConsecutivePassLots: 14 });
  });

  it('keeps the level for drift or a large operator/inspector gap', () => {
    expect(judgeSelfInspectionReduction({ ...capable, drift: true }, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY).verdict).toBe(
      'keep'
    );
    expect(
      judgeSelfInspectionReduction({ ...capable, measurementGapRatio: 0.2 }, DEFAULT_SELF_INSPECTION_REDUCTION_POLICY).verdict
    ).toBe('keep');
  });

  it('reports parts without toleranced numeric items as unjudgeable', () => {
    const result = judgeSelfInspectionReduction(
      { ...capable, evaluable: false, worstCpk: null, sampleCount: 0 },
      DEFAULT_SELF_INSPECTION_REDUCTION_POLICY
    );
    expect(result.verdict).toBe('unjudgeable');
  });

  it('keeps the lowest level even when every condition is met', () => {
    const result = judgeSelfInspectionReduction(
      { ...capable, level: { mode: 'single', fixedCount: null } },
      DEFAULT_SELF_INSPECTION_REDUCTION_POLICY
    );
    expect(result).toMatchObject({ verdict: 'keep', target: null });
  });
});
