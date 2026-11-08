import { describe, expect, it } from 'vitest';

import { escapeCsvCell } from '../csv.js';

describe('escapeCsvCell', () => {
  it.each(['=SUM(A1)', '+1+1', '-1+1', '@x', '\tx'])('prefixes %s for spreadsheet text', value => {
    expect(escapeCsvCell(value)).toBe("'" + value);
    expect(escapeCsvCell(value, true)).toBe(`"'${value}"`);
  });
  it('quotes a carriage return after adding the prefix', () => {
    expect(escapeCsvCell('\rx')).toBe(`"'\rx"`);
  });
  it.each(['-0.5', '+3', '1e-3', '-.5', '+3.', '-1E+3', 'normal', "'text", ''])('preserves %s', value => {
    expect(escapeCsvCell(value)).toBe(value);
    expect(escapeCsvCell(value, true)).toBe(`"${value}"`);
  });
  it.each(['a"b', 'a,b', 'a\nb', 'a\rb'])('keeps CSV quoting for %s', value => {
    const expected = `"${value.replace(/"/g, '""')}"`;
    expect(escapeCsvCell(value)).toBe(expected);
    expect(escapeCsvCell(value, true)).toBe(expected);
  });
  it('handles numeric and missing values', () => {
    expect(escapeCsvCell(-0.5)).toBe('-0.5');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined, true)).toBe('""');
  });
});
