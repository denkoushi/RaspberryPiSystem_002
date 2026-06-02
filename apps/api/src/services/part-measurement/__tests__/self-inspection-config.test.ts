import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import {
  assertEntryIndexAllowed,
  entrySlotLabelFromKind,
  inferEntrySlotKindForIndex,
  listRequiredEntrySlots,
  resolveReviseSelfInspectionFields,
  selfInspectionPatchFromReviseBody,
  tryResolveExpectedEntryCount,
  validateSelfInspectionConfig
} from '../self-inspection-config.js';

describe('validateSelfInspectionConfig', () => {
  it('rejects first_last when plannedQuantity is 1', () => {
    expect(() =>
      validateSelfInspectionConfig({
        mode: 'first_last',
        plannedQuantity: 1
      })
    ).toThrow(ApiError);
  });

  it('rejects fixed_count above plannedQuantity', () => {
    expect(() =>
      validateSelfInspectionConfig({
        mode: 'fixed_count',
        fixedCount: 5,
        plannedQuantity: 3
      })
    ).toThrow(ApiError);
  });

  it('requires fixedCount for fixed_count', () => {
    expect(() => validateSelfInspectionConfig({ mode: 'fixed_count' })).toThrow(ApiError);
  });

  it('accepts fixed_count within plannedQuantity', () => {
    const result = validateSelfInspectionConfig({
      mode: 'fixed_count',
      fixedCount: 3,
      plannedQuantity: 10
    });
    expect(result.mode).toBe('FIXED_COUNT');
    expect(result.fixedCount).toBe(3);
  });
});

describe('listRequiredEntrySlots', () => {
  it('first_last uses indices 0 and plannedQuantity-1', () => {
    const slots = listRequiredEntrySlots(
      { selfInspectionMode: 'FIRST_LAST', selfInspectionFixedCount: null },
      5
    );
    expect(slots.map((s) => s.entryIndex)).toEqual([0, 4]);
    expect(slots.map((s) => s.entrySlotKind)).toEqual(['first', 'last']);
  });

  it('single allows only index 0', () => {
    expect(() =>
      assertEntryIndexAllowed(
        { selfInspectionMode: 'SINGLE', selfInspectionFixedCount: null },
        10,
        1
      )
    ).toThrow(ApiError);
    const slot = assertEntryIndexAllowed(
      { selfInspectionMode: 'SINGLE', selfInspectionFixedCount: null },
      10,
      0
    );
    expect(slot.entrySlotKind).toBe('single');
  });
});

describe('tryResolveExpectedEntryCount', () => {
  it('maps SAMPLE template config to fixed count', () => {
    const count = tryResolveExpectedEntryCount(
      { selfInspectionMode: 'SAMPLE', selfInspectionFixedCount: null, selfInspectionSampleSize: 4 },
      100
    );
    expect(count).toBe(4);
  });

  it('infers slot kind for first_last last index', () => {
    const kind = inferEntrySlotKindForIndex(
      { selfInspectionMode: 'FIRST_LAST', selfInspectionFixedCount: null },
      8,
      7
    );
    expect(kind).toBe('LAST');
  });
});

describe('entrySlotLabelFromKind', () => {
  it('uses entryIndex + 1 for fixed slots', () => {
    expect(entrySlotLabelFromKind('fixed', 4)).toBe('5');
  });
});

describe('selfInspectionPatchFromReviseBody', () => {
  it('returns undefined when no self-inspection fields are sent', () => {
    expect(selfInspectionPatchFromReviseBody({})).toBeUndefined();
  });

  it('does not default mode to full when only name/items are revised', () => {
    expect(
      selfInspectionPatchFromReviseBody({
        selfInspectionFixedCount: 3
      })
    ).toEqual({
      selfInspectionFixedCount: 3
    });
  });

  it('validates when mode is explicitly sent', () => {
    const patch = selfInspectionPatchFromReviseBody({
      selfInspectionMode: 'fixed_count',
      selfInspectionFixedCount: 4
    });
    expect(patch?.selfInspectionMode).toBe('FIXED_COUNT');
    expect(patch?.selfInspectionFixedCount).toBe(4);
  });
});

describe('resolveReviseSelfInspectionFields', () => {
  it('clears fixedCount when mode changes to full with explicit null', () => {
    const result = resolveReviseSelfInspectionFields(
      { selfInspectionMode: 'FULL', selfInspectionFixedCount: null },
      { selfInspectionMode: 'FIXED_COUNT', selfInspectionFixedCount: 5 }
    );
    expect(result.mode).toBe('FULL');
    expect(result.fixedCount).toBeNull();
  });

  it('does not revive old fixedCount when switching to full without count field', () => {
    const result = resolveReviseSelfInspectionFields(
      { selfInspectionMode: 'FULL' },
      { selfInspectionMode: 'FIXED_COUNT', selfInspectionFixedCount: 5 }
    );
    expect(result.mode).toBe('FULL');
    expect(result.fixedCount).toBeNull();
  });
});
