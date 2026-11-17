import { describe, expect, it } from 'vitest';
import { normalizeEmployeeNumber } from '../procedure-material-employee-number.js';

describe('normalizeEmployeeNumber', () => {
  it.each([['007125', '7125'], ['7125', '7125'], ['0001', '1'], [' 0001 ', '1'], ['0000', '0'], ['unknown', null], ['', null], ['  ', null], ['12a', null], [null, null]])('normalizes %s', (value, expected) => {
    expect(normalizeEmployeeNumber(value)).toBe(expected);
  });
});
