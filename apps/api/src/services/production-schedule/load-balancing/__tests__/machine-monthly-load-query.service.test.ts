import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import {
  aggregateMachineMonthlyLoadByFseiban,
  listMachineMonthlyLoadQueryRows
} from '../machine-monthly-load-query.service.js';
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


const winnerRowIds = ['winner-row-a'];
const rangeStart = new Date('2026-05-01T00:00:00.000Z');
const rangeEndExclusive = new Date('2026-06-01T00:00:00.000Z');

describe('machine-monthly-load-query winner materialization SQL', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
  });

  it('aggregateMachineMonthlyLoadByFseiban uses materialized winner membership and omits fkst join', async () => {
    await aggregateMachineMonthlyLoadByFseiban({
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      rangeStart,
      rangeEndExclusive,
      winnerRowIds
    });

    const sql = captureTaggedTemplateQuerySql();
    expect(sql).toContain('= any');
    expect(sql).not.toContain('"fkst"');
    expect(sql).not.toContain('from "csvdashboardrow" as "r2"');
  });

  it('listMachineMonthlyLoadQueryRows uses materialized winner membership and omits fkst join', async () => {
    await listMachineMonthlyLoadQueryRows({
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      rangeStart,
      rangeEndExclusive,
      fseibans: ['FS-1'],
      winnerRowIds
    });

    const sql = captureTaggedTemplateQuerySql();
    expect(sql).toContain('= any');
    expect(sql).not.toContain('"fkst"');
    expect(sql).not.toContain('from "csvdashboardrow" as "r2"');
  });
});
