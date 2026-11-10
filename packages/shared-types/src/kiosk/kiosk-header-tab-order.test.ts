import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KIOSK_HEADER_TAB_ORDER,
  KIOSK_REORDERABLE_HEADER_TAB_IDS,
  isKioskReorderableHeaderTabId,
  normalizeKioskHeaderTabOrder
} from './kiosk-header-tab-order.js';

describe('isKioskReorderableHeaderTabId', () => {
  it('accepts known ids exactly and rejects fixed/unknown/untrimmed ids', () => {
    expect(isKioskReorderableHeaderTabId('borrow')).toBe(true);
    expect(isKioskReorderableHeaderTabId('call')).toBe(true);
    expect(isKioskReorderableHeaderTabId('signage')).toBe(false);
    expect(isKioskReorderableHeaderTabId(' borrow')).toBe(false);
    expect(isKioskReorderableHeaderTabId('BORROW')).toBe(false);
    expect(isKioskReorderableHeaderTabId('')).toBe(false);
  });
});

describe('normalizeKioskHeaderTabOrder', () => {
  it('returns the default order for empty input', () => {
    expect(normalizeKioskHeaderTabOrder([])).toEqual([...DEFAULT_KIOSK_HEADER_TAB_ORDER]);
  });

  it('keeps requested ids first, then appends missing ids in default order', () => {
    const result = normalizeKioskHeaderTabOrder(['call', 'production_schedule']);
    expect(result.slice(0, 2)).toEqual(['call', 'production_schedule']);
    expect(result.slice(2)).toEqual(
      DEFAULT_KIOSK_HEADER_TAB_ORDER.filter((id) => id !== 'call' && id !== 'production_schedule')
    );
    expect(result).toHaveLength(KIOSK_REORDERABLE_HEADER_TAB_IDS.length);
  });

  it('trims ids, drops unknown ids and keeps the first occurrence of duplicates', () => {
    const result = normalizeKioskHeaderTabOrder([' due_management ', 'unknown', 'borrow', 'due_management', 'signage', 'borrow']);
    expect(result.slice(0, 2)).toEqual(['due_management', 'borrow']);
    expect(result.filter((id) => id === 'due_management')).toHaveLength(1);
    expect(result.filter((id) => id === 'borrow')).toHaveLength(1);
    expect(result).not.toContain('unknown');
    expect(new Set(result).size).toBe(KIOSK_REORDERABLE_HEADER_TAB_IDS.length);
  });

  it('returns a full permutation unchanged', () => {
    const reversed = [...KIOSK_REORDERABLE_HEADER_TAB_IDS].reverse();
    expect(normalizeKioskHeaderTabOrder(reversed)).toEqual(reversed);
  });
});
