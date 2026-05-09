import { describe, expect, it } from 'vitest';

import { buildFkojunstScheduleCsvDisappearanceEligibleScalarSql } from '../fkojunst-production-schedule-list-visibility.policy.js';

function prismaSqlToLiteralString(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  const { strings, values } = sql;
  return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ''), '');
}

describe('buildFkojunstScheduleCsvDisappearanceEligibleScalarSql', () => {
  it('requires fkmail row and excludes only status C (C以外に差分消失を適用)', () => {
    const frag = buildFkojunstScheduleCsvDisappearanceEligibleScalarSql();
    const text = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });

    expect(text).toMatch(/"fkmail"\."id"\s+IS\s+NOT\s+NULL/i);
    expect(text).toMatch(/"fkmail"\."statusCode"\s+<>\s+'C'/);
    expect(text).not.toMatch(/IN\s*\(\s*'S'\s*,\s*'R'\s*\)/);
  });
});
