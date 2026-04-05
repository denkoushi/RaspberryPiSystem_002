import { describe, expect, it } from 'vitest';

import { formatKioskPartMeasurementDraftUpdatedAt } from './formatKioskPartMeasurementDraftUpdatedAt';

describe('formatKioskPartMeasurementDraftUpdatedAt', () => {
  it('returns fallback for empty or invalid input', () => {
    expect(formatKioskPartMeasurementDraftUpdatedAt('')).toBe('—');
    expect(formatKioskPartMeasurementDraftUpdatedAt('   ')).toBe('—');
    expect(formatKioskPartMeasurementDraftUpdatedAt('not-a-date')).toBe('—');
  });

  it('includes weekday (ja short) and has no seconds segment in time', () => {
    const out = formatKioskPartMeasurementDraftUpdatedAt('2026-04-05T06:30:00.000Z');
    expect(out).toMatch(/\([日月火水木金土]\)/);
    expect(out).not.toMatch(/\b\d{1,2}:\d{2}:\d{2}\b/);
    expect(out).toContain('2026');
  });
});
