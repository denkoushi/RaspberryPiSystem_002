import { describe, expect, it, vi } from 'vitest';

import {
  buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner,
  buildMaterializedMaxProductNoWinnerInCondition,
  fetchMaxProductNoWinnerRowIdsForDashboard
} from '../row-resolver/max-product-no-winner-materialization.js';

function prismaSqlToLiteralString(sql: { strings: readonly string[]; values: readonly unknown[] }): string {
  const { strings, values } = sql;
  return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ''), '');
}

function syntheticWinnerIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
}

describe('fetchMaxProductNoWinnerRowIdsForDashboard (unit)', () => {
  it('maps prisma rows into id strings', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'x' }, { id: 'y' }]);

    const ids = await fetchMaxProductNoWinnerRowIdsForDashboard({
      prisma: { $queryRaw: queryRaw as never },
      csvDashboardId: 'dashboard-test'
    });

    expect(ids).toEqual(['x', 'y']);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('buildMaterializedMaxProductNoWinnerInCondition (unit)', () => {
  it('returns FALSE with no bind params when winnerRowIds is empty', () => {
    const frag = buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', []);
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });
    const { values } = frag as { strings: readonly string[]; values: readonly unknown[] };

    expect(sql).toContain('FALSE');
    expect(values.length).toBe(0);
  });

  it('uses one text[] array bind regardless of winner id count', () => {
    const winnerRowIds = syntheticWinnerIds(5000);
    const frag = buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', winnerRowIds);
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });
    const { values } = frag as { strings: readonly string[]; values: readonly unknown[] };

    expect(sql).toContain('= ANY');
    expect(sql).toContain('::text[]');
    expect(sql).toContain('"CsvDashboardRow"."id"');
    expect(sql).not.toContain('unnest');
    expect(sql).not.toMatch(/\bIN\s*\(/);

    const arrayValues = values.filter((value) => Array.isArray(value));
    expect(arrayValues).toHaveLength(1);
    expect(arrayValues[0]).toHaveLength(winnerRowIds.length);
    expect(arrayValues[0]).toEqual(winnerRowIds);
  });

  it('quotes the row alias in the membership condition', () => {
    const frag = buildMaterializedMaxProductNoWinnerInCondition('r', ['row-a']);
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });

    expect(sql).toContain('"r"."id"');
  });

  it('rejects invalid SQL identifiers for rowAlias', () => {
    expect(() => buildMaterializedMaxProductNoWinnerInCondition('bad-alias', ['row-a'])).toThrow(
      'Invalid SQL identifier: bad-alias'
    );
    expect(() =>
      buildMaterializedMaxProductNoWinnerInCondition('"; DROP TABLE', ['row-a'])
    ).toThrow('Invalid SQL identifier');
  });
});

describe('buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner (unit)', () => {
  it('keeps dashboard scope and correlated winner predicate in the base WHERE', () => {
    const frag = buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner('dashboard-test');
    const sql = prismaSqlToLiteralString(frag as { strings: readonly string[]; values: readonly unknown[] });

    expect(sql).toContain('"CsvDashboardRow"."csvDashboardId"');
    expect(sql).toContain('dashboard-test');
    expect(sql).toContain('"CsvDashboardRow"."id" = (');
    expect(sql).toContain('FROM "CsvDashboardRow" AS "r2"');
    expect(sql).toContain('LIMIT 1');
  });
});
