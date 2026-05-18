import { describe, expect, it } from 'vitest';

import { buildFkojunstScheduleCsvDisappearanceEligibleScalarSql } from '../fkojunst-production-schedule-list-visibility.policy.js';

function prismaSqlToLiteralString(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  const { strings, values } = sql;
  return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ''), '');
}

describe('buildFkojunstScheduleCsvDisappearanceEligibleScalarSql', () => {
  it('requires fkmail row and excludes mail-completed statuses C and X (メール完了は消滅母集団外)', () => {
    const frag = buildFkojunstScheduleCsvDisappearanceEligibleScalarSql();
    const text = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });

    expect(text).toMatch(/"fkmail"\."id"\s+IS\s+NOT\s+NULL/i);
    expect(text).toMatch(/UPPER\s*\(\s*BTRIM\s*\(\s*"fkmail"\."statusCode"\)/i);
    expect(text).toMatch(/NOT\s+COALESCE/i);
    expect(text).toMatch(/IN\s*\(\s*C\s*,\s*X\s*\)/);
    expect(text).not.toMatch(/IN\s*\(\s*'S'\s*,\s*'R'\s*\)/);
  });
});
