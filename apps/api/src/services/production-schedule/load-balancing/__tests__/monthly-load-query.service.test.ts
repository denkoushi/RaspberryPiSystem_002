import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import {
  aggregateMonthlyLoadByResource,
  listMonthlyLoadRowCandidates
} from '../monthly-load-query.service.js';
import { captureTaggedTemplateQuerySql } from './prisma-query-sql-test-utils.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: { $queryRaw: vi.fn() }
}));

vi.mock('../../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: vi.fn().mockResolvedValue({
    excludedCuttingResourceCds: [],
    resourceCategoryByCd: new Map()
  }),
  normalizeProductionScheduleResourceCd: (cd: string) => cd.trim().toUpperCase(),
  isProductionScheduleExcludedCuttingResourceCd: () => false
}));


const winnerRowIds = ['winner-row-a', 'winner-row-b'];

describe('monthly-load-query winner materialization SQL', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
  });

  it('aggregateMonthlyLoadByResource uses materialized winner membership and omits fkst join', async () => {
    await aggregateMonthlyLoadByResource({
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      yearMonth: '2026-05',
      winnerRowIds
    });

    const sql = captureTaggedTemplateQuerySql();
    expect(sql).toContain('= any');
    expect(sql).toContain('"csvdashboardrow"."id"');
    expect(sql).toContain('::text[]');
    expect(sql).not.toContain('"fkst"');
    expect(sql).not.toContain('from "csvdashboardrow" as "r2"');
    expect(sql).not.toContain('limit 1');
  });

  it('listMonthlyLoadRowCandidates uses materialized winner membership and omits fkst join', async () => {
    await listMonthlyLoadRowCandidates({
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      yearMonth: '2026-05',
      winnerRowIds
    });

    const sql = captureTaggedTemplateQuerySql();
    expect(sql).toContain('= any');
    expect(sql).toContain('"csvdashboardrow"."id"');
    expect(sql).not.toContain('"fkst"');
    expect(sql).not.toContain('from "csvdashboardrow" as "r2"');
  });

  it('listMonthlyLoadRowCandidates returns FALSE predicate when winnerRowIds is empty', async () => {
    await listMonthlyLoadRowCandidates({
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      yearMonth: '2026-05',
      winnerRowIds: []
    });

    const sql = captureTaggedTemplateQuerySql();
    expect(sql).toContain('false');
    expect(sql).not.toContain('= any');
  });
});
