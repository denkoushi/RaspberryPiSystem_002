import { describe, expect, it } from 'vitest';

import { areRequiredSelfInspectionSlotsFilled, listSelfInspectionEntrySlots } from '../selfInspectionEntrySlots';

import { makeSelfInspectionLotEntryForTest } from './selfInspectionSessionTestFixtures';

describe('listSelfInspectionEntrySlots', () => {
  it('uses requiredEntryCount for legacy full sessions (expected < planned)', () => {
    const slots = listSelfInspectionEntrySlots({
      selfInspectionMode: 'full',
      plannedQuantity: 100,
      expectedEntryCount: 2,
      requiredEntryCount: 100
    });
    expect(slots).toHaveLength(100);
    expect(slots[0]?.entryIndex).toBe(0);
    expect(slots[99]?.entryIndex).toBe(99);
  });

  it('uses expectedEntryCount for fixed_count', () => {
    const slots = listSelfInspectionEntrySlots({
      selfInspectionMode: 'fixed_count',
      plannedQuantity: 100,
      expectedEntryCount: 5,
      requiredEntryCount: 5
    });
    expect(slots).toHaveLength(5);
  });

  it('first_last requires indices 0 and plannedQuantity-1', () => {
    const slots = listSelfInspectionEntrySlots({
      selfInspectionMode: 'first_last',
      plannedQuantity: 5,
      expectedEntryCount: 2,
      requiredEntryCount: 2
    });
    expect(slots.map((s) => s.entryIndex)).toEqual([0, 4]);
    expect(
      areRequiredSelfInspectionSlotsFilled({
        selfInspectionMode: 'first_last',
        plannedQuantity: 5,
        expectedEntryCount: 2,
        requiredEntryCount: 2,
        entries: [
          makeSelfInspectionLotEntryForTest({ entryIndex: 0, entrySlotKind: 'first', entrySlotLabel: '最初' }),
          makeSelfInspectionLotEntryForTest({ entryIndex: 4, entrySlotKind: 'last', entrySlotLabel: '最終' })
        ]
      })
    ).toBe(true);
    expect(
      areRequiredSelfInspectionSlotsFilled({
        selfInspectionMode: 'first_last',
        plannedQuantity: 5,
        expectedEntryCount: 2,
        requiredEntryCount: 2,
        entries: [
          makeSelfInspectionLotEntryForTest({ entryIndex: 0, entrySlotKind: 'first', entrySlotLabel: '最初' }),
          makeSelfInspectionLotEntryForTest({ entryIndex: 1, entrySlotKind: 'fixed', entrySlotLabel: '2' })
        ]
      })
    ).toBe(false);
  });

  it('single requires only index 0', () => {
    expect(
      areRequiredSelfInspectionSlotsFilled({
        selfInspectionMode: 'single',
        plannedQuantity: 10,
        expectedEntryCount: 1,
        requiredEntryCount: 1,
        entries: [makeSelfInspectionLotEntryForTest({ entryIndex: 0, entrySlotKind: 'single', entrySlotLabel: '1件' })]
      })
    ).toBe(true);
    expect(
      areRequiredSelfInspectionSlotsFilled({
        selfInspectionMode: 'single',
        plannedQuantity: 10,
        expectedEntryCount: 1,
        requiredEntryCount: 1,
        entries: []
      })
    ).toBe(false);
  });
});
