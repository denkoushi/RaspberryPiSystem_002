import { describe, expect, it } from 'vitest';

import {
  compareProcessingTypePriority,
  getProcessingTypePriority
} from '../policies/processing-priority-policy.js';

describe('processing-priority-policy', () => {
  it('returns expected priority order', () => {
    expect(getProcessingTypePriority('LSLH')).toBeLessThan(getProcessingTypePriority('カニゼン'));
    expect(getProcessingTypePriority('カニゼン')).toBeLessThan(getProcessingTypePriority('塗装'));
    expect(getProcessingTypePriority('塗装')).toBeLessThan(getProcessingTypePriority('その他01'));
    expect(getProcessingTypePriority('その他01')).toBeLessThan(getProcessingTypePriority('その他02'));
  });

  it('treats unknown or empty processing type as lowest priority', () => {
    expect(getProcessingTypePriority('未知工程')).toBeGreaterThan(getProcessingTypePriority('その他02'));
    expect(getProcessingTypePriority('')).toBeGreaterThan(getProcessingTypePriority('その他02'));
  });

  it('compare function follows priority ascending', () => {
    expect(compareProcessingTypePriority('LSLH', '塗装')).toBeLessThan(0);
    expect(compareProcessingTypePriority('塗装', 'LSLH')).toBeGreaterThan(0);
    expect(compareProcessingTypePriority('塗装', '塗装')).toBe(0);
  });
});
