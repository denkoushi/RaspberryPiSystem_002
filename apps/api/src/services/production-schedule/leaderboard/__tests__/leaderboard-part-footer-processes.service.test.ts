import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: async () => ({}),
  isProductionScheduleExcludedCuttingResourceCd: () => false
}));
vi.mock('../../resource-master.service.js', () => ({ getResourceNameMapByResourceCds: async () => ({}) }));

import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from '../leaderboard-part-footer-processes.service.js';

const row = (productNo: string) => ({
  id: 'displayed', seibanJoinKey: ' ORDER ',
  rowData: { FSEIBAN: ' ORDER ', FHINCD: ' PART ', ProductNo: productNo }
});

describe('leaderboard footer process lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
  });

  it.each(['100', ''])('keeps ProductNo %j and uses trimmed indexed keys with nonempty guards', async (productNo) => {
    expect(await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [row(productNo)], locationKey: 'site'
    })).toEqual({ [['ORDER', productNo, 'PART'].join('\0')]: [] });
    const query = mocks.query.mock.calls[0]![0];
    const sql = query.strings.join('?');
    expect(sql).toContain(`BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN') = "targetKeys"."seibanJoinKey"`);
    expect(sql).toContain(`"targetKeys"."seibanJoinKey" <> ''`);
    expect(sql).toContain(`BTRIM("CsvDashboardRow"."rowData"->>'FHINCD') = "targetKeys"."fhincd"`);
    expect(sql).toContain(`"targetKeys"."fhincd" <> ''`);
    expect(sql).toContain(`COALESCE(NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'ProductNo'), ''), '') = "targetKeys"."productNo"`);
    expect(sql).toContain('SELECT DISTINCT ON');
    expect(sql).toContain('COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE)');
    expect(query.values.slice(0, 3)).toEqual(['ORDER', productNo, 'PART']);
  });

  it('omits empty part keys without querying', async () => {
    expect(await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [{ ...row('100'), rowData: { FHINCD: ' ' } }], locationKey: 'site'
    })).toBeUndefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
