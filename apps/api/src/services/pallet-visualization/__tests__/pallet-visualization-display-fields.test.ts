import { describe, expect, it } from 'vitest';

import {
  buildPalletMachineNameDisplay,
  extractOutsideDimensionsDisplay,
  formatPlannedStartDateForPalletDisplay,
  normalizeOutsideDimensionsDisplay,
  readPalletItemDisplayFromScheduleSnapshot,
} from '../pallet-visualization-display-fields.js';

describe('pallet-visualization-display-fields', () => {
  it('normalizeOutsideDimensionsDisplay collapses whitespace', () => {
    expect(normalizeOutsideDimensionsDisplay('  10 x  20  ')).toBe('10 x 20');
  });

  it('extractOutsideDimensionsDisplay reads known keys', () => {
    expect(extractOutsideDimensionsDisplay({ FGAISUN: ' 12×34 ' })).toBe('12×34');
    expect(extractOutsideDimensionsDisplay({ FSUNPO: 99 })).toBe('99');
    expect(extractOutsideDimensionsDisplay({})).toBeNull();
  });

  it('formatPlannedStartDateForPalletDisplay returns YYYY-MM-DD', () => {
    expect(formatPlannedStartDateForPalletDisplay(new Date('2026-04-23T00:00:00.000Z'))).toBe('2026-04-23');
    expect(formatPlannedStartDateForPalletDisplay(null)).toBeNull();
  });

  it('buildPalletMachineNameDisplay applies hyphen truncation and ascii upper', () => {
    expect(buildPalletMachineNameDisplay('abc-ignored')).toBe('ABC');
    expect(buildPalletMachineNameDisplay('')).toBeNull();
    expect(buildPalletMachineNameDisplay(null)).toBeNull();
  });

  it('readPalletItemDisplayFromScheduleSnapshot parses augment fields', () => {
    expect(
      readPalletItemDisplayFromScheduleSnapshot({
        plannedQuantity: 3,
        plannedStartDateDisplay: '2026-01-02',
        outsideDimensionsDisplay: ' 1 2 ',
      })
    ).toEqual({
      plannedQuantity: 3,
      plannedStartDateDisplay: '2026-01-02',
      outsideDimensionsDisplay: '1 2',
    });
  });
});
