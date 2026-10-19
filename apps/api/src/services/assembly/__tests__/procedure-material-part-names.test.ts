import { describe, expect, it, vi } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { readPartNamesByPartNumbers, readPartNumbersByPartName } from '../../work-instructions/repositories/prisma-work-instruction-part-names.js';

describe('procedure material schedule part names', () => {
  it('normalizes and deduplicates parts in one lookup using the existing alias name selection', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ partNumber: 'MH-1', partName: ' ホルダー ' }, { partNumber: 'EMPTY', partName: '' }]) };
    const names = await readPartNamesByPartNumbers(db as never, [' ＭＨ－１ ', 'mh-1', 'EMPTY', 'MISSING', '']);
    expect([...names]).toEqual([['MH-1', 'ホルダー'], ['EMPTY', null]]);
    expect(names.get('MISSING') ?? null).toBeNull();
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    const query = db.$queryRaw.mock.calls[0][0];
    expect(query.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, 'MH-1', 'EMPTY', 'MISSING']);
    expect(query.sql).toContain(`MIN(NULLIF(TRIM("rowData"->>'FHINMEI'), ''))`);
    expect(query.sql).toContain(`UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))) IN`);
  });
  it('skips empty lookups and blank name queries', async () => {
    const db = { $queryRaw: vi.fn() };
    expect(await readPartNamesByPartNumbers(db as never, [' ', ''])).toEqual(new Map());
    expect(await readPartNumbersByPartName(db as never, '　')).toEqual([]);
    expect(await readPartNumbersByPartName(db as never, ' Ａ ')).toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('normalizes stored names and queries, escapes LIKE wildcards and caps the deterministic reverse lookup', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ partNumber: ' mh-1 ' }, { partNumber: 'MH-1' }]) };
    expect(await readPartNumbersByPartName(db as never, ' Ｈｏｌ％＿\\ ', 500)).toEqual(['MH-1']);
    const query = db.$queryRaw.mock.calls[0][0];
    expect(query.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, '%Hol\\%\\_\\\\%', 200]);
    expect(query.sql).toContain(`NORMALIZE("rowData"->>'FHINMEI', NFKC) ILIKE`);
    expect(query.sql).toContain('ORDER BY "partNumber" ASC LIMIT');
    await readPartNumbersByPartName(db as never, 'ﾎﾙ', 20);
    expect(db.$queryRaw.mock.calls[1][0].values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, '%ホル%', 20]);
  });
});
