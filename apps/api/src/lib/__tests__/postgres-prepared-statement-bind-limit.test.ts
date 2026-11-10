import { describe, expect, it } from 'vitest';

import { POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS, maxTuplePlaceholdersPerQuery } from '../postgres-prepared-statement-bind-limit.js';

describe('maxTuplePlaceholdersPerQuery', () => {
  it('uses the 32767 bind limit', () => {
    expect(POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS).toBe(32767);
  });

  it('computes floor((limit - fixed) / perTuple)', () => {
    expect(maxTuplePlaceholdersPerQuery(3, 0)).toBe(10922);
    expect(maxTuplePlaceholdersPerQuery(3, 2)).toBe(10921);
    expect(maxTuplePlaceholdersPerQuery(1, 0)).toBe(32767);
  });

  it('never lets the resulting bind count exceed the limit', () => {
    for (const [per, fixed] of [[3, 7], [5, 100], [7, 1]] as const) {
      const n = maxTuplePlaceholdersPerQuery(per, fixed);
      expect(fixed + per * n).toBeLessThanOrEqual(32767);
      expect(fixed + per * (n + 1)).toBeGreaterThan(32767);
    }
  });

  it('floors fractional inputs and clamps perTuple to at least 1 and fixed to at least 0', () => {
    expect(maxTuplePlaceholdersPerQuery(2.9, 1.9)).toBe(maxTuplePlaceholdersPerQuery(2, 1));
    expect(maxTuplePlaceholdersPerQuery(0, 0)).toBe(32767);
    expect(maxTuplePlaceholdersPerQuery(-4, -10)).toBe(32767);
  });

  it('returns 1 when the fixed bind count leaves no room for a full tuple', () => {
    expect(maxTuplePlaceholdersPerQuery(3, 32765)).toBe(1);
    expect(maxTuplePlaceholdersPerQuery(3, 40000)).toBe(1);
    expect(maxTuplePlaceholdersPerQuery(3, 32764)).toBe(1);
  });
});
