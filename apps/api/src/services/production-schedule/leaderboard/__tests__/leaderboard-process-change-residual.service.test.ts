import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: { $queryRaw: queryRawMock }
}));

vi.mock('../../production-schedule-query.service.js', () => ({
  prepareProductionScheduleDashboardFilters: vi.fn(async () => ({
    kind: 'ok',
    queryWhere: Prisma.empty,
    siteScopedGlobalRankLocation: 'site-1'
  }))
}));

vi.mock('../../row-resolver/index.js', () => ({
  resolveLeaderboardMaterializedBaseWhere: vi.fn(async () => Prisma.sql`TRUE`)
}));

import { buildProcessChangeResidualStrongEvidenceKey } from '../leaderboard-process-change-residual.keys.js';
import { fetchLeaderboardProcessChangeResidualSummary } from '../leaderboard-process-change-residual.service.js';

function toSql(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

describe('fetchLeaderboardProcessChangeResidualSummary', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it('matches evidence keys with one text[] ANY bind instead of a VALUES join', async () => {
    queryRawMock.mockResolvedValueOnce([{ total: 2n }]).mockResolvedValueOnce([]);
    const keys = new Set([
      buildProcessChangeResidualStrongEvidenceKey({ productNo: '0001', fkojun: '010', resourceCd: '581' }),
      buildProcessChangeResidualStrongEvidenceKey({ productNo: '0002', fkojun: '020', resourceCd: '305' })
    ]);

    const result = await fetchLeaderboardProcessChangeResidualSummary({
      queryText: '',
      productNos: [],
      locationKey: 'loc-1',
      processChangeResidualMaterialization: {
        keys,
        keyArrays: { productNos: [], fkojuns: [], resourceCds: [] },
        evidenceByKey: new Map(),
        rawMailRowsRevision: 'revision-1'
      }
    });

    expect(result.processChangeResidualTotal).toBe(2);
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    for (const call of queryRawMock.mock.calls) {
      const sql = toSql(call);
      expect(sql.text).not.toContain('residual_keys');
      expect(sql.text).toContain('= ANY(');
      expect(sql.values).toContainEqual(['4:0001|3:010|3:581', '4:0002|3:020|3:305']);
    }
  });
});
