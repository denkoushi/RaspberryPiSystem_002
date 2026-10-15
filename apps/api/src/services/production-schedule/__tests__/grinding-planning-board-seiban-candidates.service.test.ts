import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), policy: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: mocks.policy }));
vi.mock('../row-resolver/index.js', () => ({ resolveLeaderboardMaterializedBaseWhere: async () => Prisma.sql`TRUE` }));
vi.mock('../seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: async () => ({ machineNames: {} }) }));

import {
  getGrindingPlanningBoardSeibanCandidates,
  resolveSeibanCandidateDateRange,
  todayJstYmd
} from '../grinding-planning-board-seiban-candidates.service.js';

describe('grinding planning board seiban candidate date range', () => {
  it.each([{ excluded: [] }, { excluded: ['10', 'MSZ'] }])('scopes all candidates to nonempty, nonexcluded resources: %j', async ({ excluded }) => {
    mocks.policy.mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: excluded });
    mocks.query.mockResolvedValue([]);
    await getGrindingPlanningBoardSeibanCandidates({ siteKey: 'site-a', category: 'all', now: new Date('2026-09-11') });
    const sql = mocks.query.mock.lastCall![0] as Prisma.Sql;
    expect(sql.text).toContain(`NULLIF(UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')), '') IS NOT NULL`);
    expect(sql.values).not.toContain('305');
    if (excluded.length) {
      expect(sql.text).toContain('NOT IN');
      expect(sql.values).toEqual(expect.arrayContaining(excluded));
    } else expect(sql.text).not.toContain('NOT IN');
  });

  it('uses the JST calendar date, including the UTC boundary', () => {
    expect(todayJstYmd(new Date('2026-09-10T14:59:59.999Z'))).toBe('2026-09-10');
    expect(todayJstYmd(new Date('2026-09-10T15:00:00.000Z'))).toBe('2026-09-11');
  });

  it('clamps month-end when shifting one calendar month', () => {
    expect(resolveSeibanCandidateDateRange('2024-03-31')).toEqual({
      rangeStart: '2024-02-29',
      rangeEnd: '2024-04-30'
    });
    expect(resolveSeibanCandidateDateRange('2024-01-31')).toEqual({
      rangeStart: '2023-12-31',
      rangeEnd: '2024-02-29'
    });
  });
});
