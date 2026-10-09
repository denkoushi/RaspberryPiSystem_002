import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { ProcedureManualPartCandidatesService } from '../procedure-manual-part-candidates.service.js';

const service = new ProcedureManualPartCandidatesService();
afterEach(() => vi.restoreAllMocks());

function queryHarness() {
  const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
  const sql = () => query.mock.calls[0][0] as Prisma.Sql;
  return { query, sql };
}

describe('procedure manual part candidates', () => {
  it('merges schedule names and manual parts by the normalized PART key in the database', async () => {
    const { query, sql } = queryHarness();
    const parts = [
      { partNumber: ' ｐａｒｔ－① ', partNumberKey: 'PART-1', partName: '軸', hasManual: true },
      { partNumber: 'PART-2', partNumberKey: 'PART-2', partName: null, hasManual: false },
    ];
    query.mockResolvedValue(parts);
    expect(await service.list({ q: 'PART' })).toEqual(parts);
    expect(query).toHaveBeenCalledOnce();
    expect(sql().text).toContain('NORMALIZE(a."modelCode", NFKC)');
    expect(sql().text).toContain('NORMALIZE("rowData"->>\'FHINCD\', NFKC)');
    expect(sql().text).toContain('WHERE p."subjectKind" = \'PART\'');
    expect(sql().text).toContain('GROUP BY "partNumberKey"');
    expect(sql().text).toContain('MIN("partName") AS "partName", BOOL_OR("hasManual")');
    expect(sql().text).toMatch(/ORDER BY \("partNumberKey" = \$\d+\) DESC, "hasManual" DESC, "partNumberKey" ASC/);
    expect(sql().values).toContain(PRODUCTION_SCHEDULE_DASHBOARD_ID);
  });

  it.each([{}, { q: '　', digitQuery: '' }])('limits an empty search to registered manual parts (%j)', async query => {
    const { sql } = queryHarness();
    await service.list(query);
    expect(sql().text).toMatch(/WHERE \(\$\d+ OR "hasManual"\)/);
    expect(sql().values.slice(-6)).toEqual([false, '', '', '', '', 30]);
  });

  it('combines numeric substring and normalized number/name substring filters with bound values', async () => {
    const { sql } = queryHarness();
    const q = "　ａｂＣ_％'　";
    await service.list({ q, digitQuery: '123', limit: 12 });
    expect(sql().values.slice(-6)).toEqual([true, '123', "ABC_%'", "ABC_%'", "ABC_%'", 12]);
    expect(sql().text).toContain('REGEXP_REPLACE("partNumberKey", \'[^0-9]\', \'\', \'g\')');
    expect(sql().text).toContain('OR STRPOS(UPPER(NORMALIZE(COALESCE("partName", \'\'), NFKC))');
    expect(sql().text).not.toContain(q);
    expect(sql().text).not.toContain("ABC_%'");
    expect(sql().text).toContain('AND (STRPOS("partNumberKey"');
  });

  it.each([[100, 50], [0, 1], [3.9, 3]])('caps a direct service limit %s to %s', async (limit, expected) => {
    const { sql } = queryHarness();
    await service.list({ digitQuery: '0', limit });
    expect(sql().values.at(-1)).toBe(expected);
  });

  it('propagates database failures', async () => {
    const { query } = queryHarness();
    query.mockRejectedValue(new Error('database unavailable'));
    await expect(service.list({ q: '軸' })).rejects.toThrow('database unavailable');
  });
});
