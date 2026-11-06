import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { buildBoardDueDateSql } from '../../d-schedule-minutes/board-due.sql.js';
import { listStartDateLevelingQueryRows } from '../start-date-leveling-query.service.js';
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

describe('listStartDateLevelingQueryRows', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
  });

  it('uses materialized winner membership and omits fkst join', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    await listStartDateLevelingQueryRows({
      dueSource: 'scaw',
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      rangeStart: new Date('2026-05-01T00:00:00.000Z'),
      rangeEndExclusive: new Date('2026-06-01T00:00:00.000Z'),
      winnerRowIds: ['winner-row-a']
    });

    const sql = captureTaggedTemplateQuerySql();

    expect(sql).toContain('= any');
    expect(sql).not.toContain('"fkst"');
    expect(sql).not.toContain('from "csvdashboardrow" as "r2"');
  });

  it('着手日または有効納期欠損行をクエリ結果から除外しない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        rowId: 'missing-start',
        fseiban: 'S1',
        productNo: '1',
        fhincd: 'PART1',
        fkojun: '10',
        resourceCd: '033',
        requiredMinutes: 60,
        plannedStartDate: null,
        effectiveDueDate: new Date('2026-05-15T00:00:00.000Z')
      },
      {
        rowId: 'missing-due',
        fseiban: 'S2',
        productNo: '1',
        fhincd: 'PART2',
        fkojun: '20',
        resourceCd: '033',
        requiredMinutes: 90,
        plannedStartDate: new Date('2026-05-10T00:00:00.000Z'),
        effectiveDueDate: null
      },
      {
        rowId: 'complete',
        fseiban: 'S3',
        productNo: '1',
        fhincd: 'PART3',
        fkojun: '30',
        resourceCd: '033',
        requiredMinutes: 120,
        plannedStartDate: new Date('2026-05-04T00:00:00.000Z'),
        effectiveDueDate: new Date('2026-05-20T00:00:00.000Z')
      }
    ] as never);

    const rows = await listStartDateLevelingQueryRows({
      dueSource: 'scaw',
      siteKey: '第2工場',
      deviceScopeKey: 'mac',
      rangeStart: new Date('2026-05-01T00:00:00.000Z'),
      rangeEndExclusive: new Date('2026-06-01T00:00:00.000Z'),
      winnerRowIds: ['winner-row-a']
    });

    expect(rows.map((r) => r.rowId).sort()).toEqual(['complete', 'missing-due', 'missing-start']);
    expect(rows.find((r) => r.rowId === 'missing-start')?.plannedStartDate).toBeNull();
    expect(rows.find((r) => r.rowId === 'missing-due')?.effectiveDueDate).toBeNull();
  });

  it.each(['excel', 'scaw'] as const)('uses the %s board due in SELECT, ORDER BY and window predicates', async (dueSource) => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    await listStartDateLevelingQueryRows({
      siteKey: '第2工場', deviceScopeKey: 'mac', dueSource,
      rangeStart: new Date('2026-05-01Z'),
      rangeEndExclusive: new Date('2026-06-01Z'),
      includeOverdueBefore: new Date('2026-05-10Z'),
      winnerRowIds: ['winner']
    });
    const sql = captureTaggedTemplateQuerySql();
    const due = buildBoardDueDateSql(dueSource).sql.toLowerCase();
    expect(sql).toContain(due + ' as "effectiveduedate"');
    expect(sql).toContain(due + ' asc nulls last');
    expect(sql).toContain(due + ' is null');
    expect(sql).toContain(due + ' <');
    expect(sql).toContain(due + ' >=');
    expect(sql).toContain('as "excel_due"');
    expect(sql).toContain('as "manual_seiban_due"');
    expect(sql).toContain('as "manual_due_at"');
  });
});
