import { describe, expect, it } from 'vitest';
import { employeeMatchesMaterialNameId, isDeveloperEmployeeNumber, normalizeEmployeeNumber } from '../procedure-material-employee-number.js';

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

describe('employeeMatchesMaterialNameId', () => {
  it.each([
    ['7125', '007125', true], ['7125', '1234', false], ['7125', '9999', false], ['7125', null, false],
    ['9999', '9999', true], ['9999', '1234', true], ['09999', '津田', true], ['9999', null, false], ['9999', '  ', false],
  ])('%s handles %s -> %s', (code, nameId, expected) => {
    expect(employeeMatchesMaterialNameId(code, nameId)).toBe(expected);
  });
});
