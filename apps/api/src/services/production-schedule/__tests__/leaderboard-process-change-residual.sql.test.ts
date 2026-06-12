import { describe, expect, it } from 'vitest';

import { buildLeaderboardProcessChangeResidualFilterWhereSql } from '../leaderboard/leaderboard-process-change-residual.sql.js';

function prismaSqlToLiteralString(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  const { strings, values } = sql;
  return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ''), '');
}

describe('leaderboard-process-change-residual.sql', () => {
  it('include mode emits no extra WHERE fragment', () => {
    const frag = buildLeaderboardProcessChangeResidualFilterWhereSql('include');
    expect(prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] })).toBe('');
  });

  it('normal mode excludes materialized strong evidence keys via ANY text array', () => {
    const keys = new Set(['PCR0001\u0000210\u00001']);
    const frag = buildLeaderboardProcessChangeResidualFilterWhereSql('normal', keys);
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });
    expect(sql).toContain('AND NOT');
    expect(sql).toContain('= ANY');
    expect(sql).not.toContain('unnest');
    expect(sql).toContain('length');
    expect(sql).toContain('7:PCR0001|3:210|1:1');
  });

  it('only mode selects materialized strong evidence keys via ANY text array', () => {
    const keys = new Set(['PCR0001\u0000210\u00001']);
    const frag = buildLeaderboardProcessChangeResidualFilterWhereSql('only', keys);
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });
    expect(sql).toContain('AND ');
    expect(sql).toContain('= ANY');
    expect(sql).not.toContain('unnest');
    expect(sql).not.toContain('AND NOT');
    expect(sql).toContain('7:PCR0001|3:210|1:1');
  });

  it('uses one array bind param regardless of key count', () => {
    const keys = new Set([
      'A\u0000210\u000001',
      'B\u0000310\u000002',
      'C\u0000410\u000003'
    ]);
    const frag = buildLeaderboardProcessChangeResidualFilterWhereSql('normal', keys);
    const { values } = frag as { strings: readonly string[]; values: readonly unknown[] };
    const arrayValues = values.filter((value) => Array.isArray(value));
    expect(arrayValues).toHaveLength(1);
    expect(arrayValues.every((value) => (value as unknown[]).length === 3)).toBe(true);
    expect((arrayValues[0] as string[]).every((value) => !value.includes('\u0000'))).toBe(true);
  });

  it('only mode with empty keys is always false', () => {
    const frag = buildLeaderboardProcessChangeResidualFilterWhereSql('only', new Set());
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });
    expect(sql).toContain('AND FALSE');
  });
});
