import { describe, expect, it } from 'vitest';

import { listSelfInspectionEntrySlots } from '../selfInspectionEntrySlots';

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
});
