import { describe, expect, it } from 'vitest';

import { selfInspectionModeDisplayLabel } from '../selfInspectionModeDisplayLabel';

describe('selfInspectionModeDisplayLabel', () => {
  it.each([
    ['full', null, '全数'],
    ['single', null, '抜き取り1個'],
    ['first_last', null, '最初と最後'],
    ['fixed_count', 7, '指定数 7 件'],
    ['fixed_count', null, '指定数 — 件']
  ] as const)('formats %s', (mode, fixedCount, expected) => {
    expect(selfInspectionModeDisplayLabel(mode, fixedCount)).toBe(expected);
  });
});
