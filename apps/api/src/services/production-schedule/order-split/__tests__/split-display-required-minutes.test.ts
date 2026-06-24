import { describe, expect, it } from 'vitest';

import { applySplitQuantityToProductionScheduleRowDisplayFields } from '../split-display-required-minutes.js';

describe('applySplitQuantityToProductionScheduleRowDisplayFields', () => {
  it('scales required minutes and FSIGENSHOYORYO by split quantity ratio', () => {
    const scaled = applySplitQuantityToProductionScheduleRowDisplayFields(
      {
        plannedQuantity: 6,
        machineRequiredMinutes: 600,
        laborRequiredMinutes: 180,
        rowData: { FSIGENSHOYORYO: '600' }
      },
      2
    );

    expect(scaled.plannedQuantity).toBe(2);
    expect(scaled.machineRequiredMinutes).toBe(200);
    expect(scaled.laborRequiredMinutes).toBe(60);
    expect(scaled.rowData).toEqual({ FSIGENSHOYORYO: '200' });
  });

  it('returns split quantity only when parent planned quantity is missing', () => {
    const scaled = applySplitQuantityToProductionScheduleRowDisplayFields(
      {
        plannedQuantity: null,
        machineRequiredMinutes: 500,
        laborRequiredMinutes: 100,
        rowData: { FSIGENSHOYORYO: '500' }
      },
      2
    );

    expect(scaled.plannedQuantity).toBe(2);
    expect(scaled.machineRequiredMinutes).toBeUndefined();
    expect(scaled.laborRequiredMinutes).toBeUndefined();
    expect(scaled.rowData).toEqual({ FSIGENSHOYORYO: '500' });
  });
});
