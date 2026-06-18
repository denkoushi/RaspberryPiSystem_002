import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  buildLeaderboardLaborMinutesLookupJoinSql,
  buildLeaderboardLaborMinutesLookupWhereSql
} from '../leaderboard-labor-minutes-lookup.sql.js';

function prismaSqlToLiteralString(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  const { strings, values } = sql;
  return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ''), '');
}

describe('leaderboard-labor-minutes-lookup.sql', () => {
  it('does not include fkmail visibility in lookup WHERE', () => {
    const keys = new Set(['PCR0001\u0000210\u000010']);
    const where = buildLeaderboardLaborMinutesLookupWhereSql({
      leaderboardMaterializedBaseWhere: Prisma.sql`TRUE`,
      processChangeResidualMode: 'normal',
      processChangeResidualStrongEvidenceKeys: keys
    });
    const sql = prismaSqlToLiteralString(where as { strings: readonly string[]; values: readonly unknown[] });
    expect(sql).not.toContain('"fkmail"');
    expect(sql).not.toContain('ProductionScheduleFkojunstMailStatus');
    expect(sql).not.toContain('ProductionScheduleFkojunstStatus');
    expect(sql).toContain('TRUE');
    expect(sql).toContain('AND NOT');
  });

  it('returns empty join fragment (no fkmail/fkst tables)', () => {
    const join = buildLeaderboardLaborMinutesLookupJoinSql();
    const sql = prismaSqlToLiteralString(join as { strings: readonly string[]; values: readonly unknown[] });
    expect(sql.trim()).toBe('');
    expect(sql).not.toContain('ProductionScheduleFkojunstMailStatus');
    expect(sql).not.toContain('ProductionScheduleFkojunstStatus');
  });
});
