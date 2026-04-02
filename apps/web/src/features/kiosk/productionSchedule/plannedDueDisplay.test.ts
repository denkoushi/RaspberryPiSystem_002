import { describe, expect, it } from 'vitest';

import { formatPlannedQuantityInlineJa, formatPlannedQuantityLabel } from './plannedDueDisplay';

describe('formatPlannedQuantityLabel', () => {
  it('returns dash for nullish and NaN', () => {
    expect(formatPlannedQuantityLabel(null)).toBe('-');
    expect(formatPlannedQuantityLabel(undefined)).toBe('-');
    expect(formatPlannedQuantityLabel(Number.NaN)).toBe('-');
  });

  it('stringifies numbers', () => {
    expect(formatPlannedQuantityLabel(3)).toBe('3');
    expect(formatPlannedQuantityLabel(-1)).toBe('-1');
  });
});

describe('formatPlannedQuantityInlineJa', () => {
  it('returns null for nullish and NaN', () => {
    expect(formatPlannedQuantityInlineJa(null)).toBeNull();
    expect(formatPlannedQuantityInlineJa(undefined)).toBeNull();
    expect(formatPlannedQuantityInlineJa(Number.NaN)).toBeNull();
  });

  it('appends 個 suffix', () => {
    expect(formatPlannedQuantityInlineJa(3)).toBe('3個');
    expect(formatPlannedQuantityInlineJa(0)).toBe('0個');
    expect(formatPlannedQuantityInlineJa(-2)).toBe('-2個');
  });
});
