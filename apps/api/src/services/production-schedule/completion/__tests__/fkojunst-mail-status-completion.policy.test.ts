import { describe, expect, it } from 'vitest';

import { buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql } from '../fkojunst-mail-status-completion.policy.js';

function prismaSqlToLiteralString(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  const { strings, values } = sql;
  return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ''), '');
}

describe('buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql', () => {
  it('uses NOT IN C,X with UPPER(BTRIM(statusCode)) for disappearance mother set eligibility', () => {
    const frag = buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql();
    const text = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });

    expect(text).toMatch(/"fkmail"\."statusCode"\s+IS\s+NOT\s+NULL/i);
    expect(text).toMatch(/NOT\s+COALESCE/i);
    expect(text).toMatch(/UPPER\s*\(\s*BTRIM\s*\(\s*"fkmail"\."statusCode"\)/i);
    expect(text).toMatch(/IN\s*\(\s*C\s*,\s*X\s*\)/);
  });
});
