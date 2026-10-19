import { describe, expect, it } from 'vitest';

import { isMachinePartCode, normalizeComparisonText } from './machineName';

describe('normalizeComparisonText', () => {
  it.each([
    [' ＭＨ ', 'MH'],
    ['sh', 'SH'],
    [null, ''],
    [undefined, ''],
    ['MX', 'MX']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeComparisonText(value)).toBe(expected);
  });
});

describe('isMachinePartCode', () => {
  it.each([
    ['ＭＨ', true],
    ['sh', true],
    [' mh123 ', true],
    [null, false],
    [undefined, false],
    ['MX', false]
  ] as const)('classifies %s as %s', (value, expected) => {
    expect(isMachinePartCode(value)).toBe(expected);
  });
});
