import { describe, expect, it } from 'vitest';

import {
  createPartSupplementAggregate,
  finalizePartSupplementAggregate,
  mergeRowIntoPartSupplementAggregate
} from '../due-management-part-supplement-aggregate.js';

describe('due-management-part-supplement-aggregate', () => {
  it('picks single distinct quantity and earliest dates', () => {
    const agg = createPartSupplementAggregate();
    mergeRowIntoPartSupplementAggregate(agg, {
      plannedQuantity: 5,
      plannedStartDate: new Date('2026-06-02T00:00:00.000Z'),
      plannedEndDate: new Date('2026-06-20T00:00:00.000Z')
    });
    mergeRowIntoPartSupplementAggregate(agg, {
      plannedQuantity: 5,
      plannedStartDate: new Date('2026-06-01T00:00:00.000Z'),
      plannedEndDate: new Date('2026-06-25T00:00:00.000Z')
    });
    const out = finalizePartSupplementAggregate(agg);
    expect(out.plannedQuantity).toBe(5);
    expect(out.plannedStartDate?.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(out.plannedEndDate?.toISOString().slice(0, 10)).toBe('2026-06-20');
  });

  it('null quantity when conflicting values', () => {
    const agg = createPartSupplementAggregate();
    mergeRowIntoPartSupplementAggregate(agg, {
      plannedQuantity: 1,
      plannedStartDate: null,
      plannedEndDate: null
    });
    mergeRowIntoPartSupplementAggregate(agg, {
      plannedQuantity: 2,
      plannedStartDate: null,
      plannedEndDate: null
    });
    const out = finalizePartSupplementAggregate(agg);
    expect(out.plannedQuantity).toBeNull();
  });
});
