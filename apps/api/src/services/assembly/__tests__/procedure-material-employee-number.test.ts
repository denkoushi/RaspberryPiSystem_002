import { describe, expect, it } from 'vitest';
import { isDeveloperEmployeeNumber, normalizeEmployeeNumber } from '../procedure-material-employee-number.js';

describe('normalizeEmployeeNumber', () => {
  it.each([['007125', '7125'], ['7125', '7125'], ['0001', '1'], [' 0001 ', '1'], ['0000', '0'], ['unknown', null], ['', null], ['  ', null], ['12a', null], [null, null]])('normalizes %s', (value, expected) => {
    expect(normalizeEmployeeNumber(value)).toBe(expected);
  });
});

describe('isDeveloperEmployeeNumber', () => {
  it.each([['9999', true], ['09999', true], [' 9999 ', true], ['999', false], ['99990', false], [null, false]])('%s -> %s', (value, expected) => {
    expect(isDeveloperEmployeeNumber(value)).toBe(expected);
  });
});
