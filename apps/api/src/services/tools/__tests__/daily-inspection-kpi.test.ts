import { describe, expect, it } from 'vitest';
import { isDailyInspectionKpiInspected } from '../daily-inspection-kpi.js';

describe('isDailyInspectionKpiInspected', () => {
  it('正常のみ件数があれば点検済み', () => {
    expect(isDailyInspectionKpiInspected(1, 0)).toBe(true);
  });

  it('異常のみ件数があれば点検済み', () => {
    expect(isDailyInspectionKpiInspected(0, 1)).toBe(true);
  });

  it('正常・異常とも0なら未点検', () => {
    expect(isDailyInspectionKpiInspected(0, 0)).toBe(false);
  });
});
