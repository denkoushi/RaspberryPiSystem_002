import { describe, expect, it } from 'vitest';

import {
  resolveInspectionDateJst,
  resolveSelfInspectionEffectiveDateJst
} from '../self-inspection-jst-date.js';

describe('self-inspection JST inspection date', () => {
  it('uses Asia/Tokyo date across UTC day boundaries', () => {
    expect(resolveInspectionDateJst(new Date('2026-06-26T14:59:59.000Z'))).toBe('2026-06-26');
    expect(resolveInspectionDateJst(new Date('2026-06-26T15:00:00.000Z'))).toBe('2026-06-27');
  });

  it('uses completedAt for completed sessions', () => {
    expect(
      resolveSelfInspectionEffectiveDateJst({
        completedAt: new Date('2026-06-26T15:00:00.000Z')
      })
    ).toBe('2026-06-27');
  });
});
