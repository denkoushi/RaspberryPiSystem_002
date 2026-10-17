import { describe, expect, it } from 'vitest';

import { toTrimmedString, toUpperTrimmedCode } from '../string-normalize.js';

describe('toTrimmedString', () => {
  it.each([
    [undefined, ''], [null, ''], ['', ''], [' \t\n ', ''],
    ['  a B  ', 'a B'], [0, '0'], [42, '42'], [false, 'false'],
    [{ toString: () => ' value ' }, 'value']
  ])('normalizes %s to %s', (value, expected) => {
    expect(toTrimmedString(value)).toBe(expected);
  });
});

describe('toUpperTrimmedCode', () => {
  it.each([[' ab-01 ', 'AB-01'], [' a b ', 'A B'], ['', ''], [' \t\n', '']])(
    'normalizes %s to %s', (value, expected) => {
      expect(toUpperTrimmedCode(value)).toBe(expected);
    }
  );
});
