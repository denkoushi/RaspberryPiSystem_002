import { describe, expect, it } from 'vitest';
import { monthOffsetsValuesSql } from '../month-offsets-values-sql.js';

describe('monthOffsetsValuesSql', () => {
  it('lists offsets monthlyMonths-1 down to 0 as literal VALUES rows', () => {
    const sql = monthOffsetsValuesSql(3, 'o');
    expect(sql.sql).toBe('(VALUES (2), (1), (0)) AS o(n)');
    expect(sql.values).toEqual([]);
  });

  it('returns a single row for monthlyMonths=1', () => {
    expect(monthOffsetsValuesSql(1, 'o').sql).toBe('(VALUES (0)) AS o(n)');
  });

  it('returns 24 rows for the maximum monthlyMonths', () => {
    const sql = monthOffsetsValuesSql(24, 'o').sql;
    expect(sql.match(/\(\d+\)/g)).toHaveLength(24);
    expect(sql.startsWith('(VALUES (23), (22),')).toBe(true);
    expect(sql.endsWith('(1), (0)) AS o(n)')).toBe(true);
  });

  it('returns an empty relation when monthlyMonths < 1 (same as an empty generate_series)', () => {
    expect(monthOffsetsValuesSql(0, 'o').sql).toBe('(SELECT 0 AS n WHERE false) AS o(n)');
  });

  it('rejects non-integer months and unsafe aliases', () => {
    expect(() => monthOffsetsValuesSql(1.5, 'o')).toThrow(RangeError);
    expect(() => monthOffsetsValuesSql(3, 'o; DROP')).toThrow(RangeError);
  });
});
