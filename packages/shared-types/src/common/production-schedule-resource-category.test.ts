import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_SCHEDULE_GRINDING_RESOURCE_CDS,
  filterProductionScheduleResourceCdsByCategory,
  isProductionScheduleGrindingResourceCd
} from './production-schedule-resource-category.js';
import {
  KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX,
  normalizeKioskProductionScheduleSearchHistory
} from './production-schedule-search-limits.js';

describe('isProductionScheduleGrindingResourceCd', () => {
  it('matches grinding resource codes after trimming', () => {
    expect(isProductionScheduleGrindingResourceCd('305')).toBe(true);
    expect(isProductionScheduleGrindingResourceCd(' 589 ')).toBe(true);
    expect(isProductionScheduleGrindingResourceCd('580')).toBe(false);
    expect(isProductionScheduleGrindingResourceCd('590')).toBe(false);
    expect(isProductionScheduleGrindingResourceCd('0305')).toBe(false);
    expect(isProductionScheduleGrindingResourceCd('')).toBe(false);
  });
});

describe('filterProductionScheduleResourceCdsByCategory', () => {
  const all = ['305', '581', '10', 'MSZ', '200', ' 582 ', ' MSZ ', 'X1'];

  it('returns the same array when category is undefined', () => {
    expect(filterProductionScheduleResourceCdsByCategory(all, undefined)).toBe(all);
  });

  it('keeps only grinding codes (original strings preserved) for grinding', () => {
    expect(filterProductionScheduleResourceCdsByCategory(all, 'grinding')).toEqual(['305', '581', ' 582 ']);
  });

  it('excludes grinding codes and the default cutting exclusions (10, MSZ) for cutting', () => {
    expect(filterProductionScheduleResourceCdsByCategory(all, 'cutting')).toEqual(['200', 'X1']);
  });

  it('replaces (not extends) the default exclusions when custom ones are provided', () => {
    expect(
      filterProductionScheduleResourceCdsByCategory(all, 'cutting', { cuttingExcludedResourceCds: [' X1 ', '', '  '] })
    ).toEqual(['10', 'MSZ', '200', ' MSZ ']);
  });

  it('never returns a grinding code for cutting even if exclusions are empty', () => {
    const result = filterProductionScheduleResourceCdsByCategory([...PRODUCTION_SCHEDULE_GRINDING_RESOURCE_CDS], 'cutting', {
      cuttingExcludedResourceCds: []
    });
    expect(result).toEqual([]);
  });
});

describe('normalizeKioskProductionScheduleSearchHistory', () => {
  it('trims, drops blanks and keeps the first occurrence', () => {
    expect(normalizeKioskProductionScheduleSearchHistory([' A1 ', '', '  ', 'B2', 'A1', 'b2'])).toEqual(['A1', 'B2', 'b2']);
  });

  it('caps the list at the shared maximum after de-duplication', () => {
    const items = Array.from({ length: KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX + 5 }, (_, i) => `S${i}`);
    const withDuplicates = ['S0', ...items];
    const result = normalizeKioskProductionScheduleSearchHistory(withDuplicates);
    expect(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX).toBe(100);
    expect(result).toHaveLength(100);
    expect(result[0]).toBe('S0');
    expect(result[99]).toBe('S99');
  });
});
