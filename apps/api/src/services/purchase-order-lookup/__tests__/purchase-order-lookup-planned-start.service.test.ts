import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));

import { findEarliestPlannedStartDatesForPurchaseRows } from '../purchase-order-lookup-planned-start.service.js';

const purchase = {
  seiban: 'BA1',
  purchasePartCodeMatchKey: 'MD100492280',
  purchasePartCodeNormalized: 'MD100492280',
  purchasePartName: 'シャフト',
};
const candidate = (fhincd: string, fhinmei: string, date: string | null, seiban = 'BA1') => ({
  seiban, fhincd, fhinmei, plannedStartDate: date ? new Date(date) : null,
});

describe('findEarliestPlannedStartDatesForPurchaseRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
  });

  it('matches code after removing annotations and numeric suffixes, taking the earliest non-null date', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate(' MD100492280(A)-001 ', '別名', '2026-05-03'),
      candidate('MD100492280-002', '別名', '2026-05-02'),
      candidate('MD100492280', '別名', null),
      candidate('MD100492280', '別名', '2026-05-04'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([purchase])).toEqual([new Date('2026-05-02')]);
  });

  it('falls back to normalized code for a legacy match key and prefers code over name', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MD100492280(A)', '別名', '2026-05-03'),
      candidate('MD100492280(B)', '別名', '2026-05-02'),
      candidate('FINISHED', 'シャフト', '2026-05-01'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([
      { ...purchase, purchasePartCodeMatchKey: 'LEGACY' },
    ])).toEqual([new Date('2026-05-02')]);
  });

  it.each(['ｼｬﾌﾄ ', 'シャフト', ' シ ャ\tフ\nト　'])('matches material code by normalized name %j', async (name) => {
    mocks.queryRaw.mockResolvedValue([
      candidate('FINISHED', name, '2026-05-03'),
      candidate('FINISHED-002', name, '2026-05-02'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([purchase])).toEqual([new Date('2026-05-02')]);
  });

  it('normalizes both purchase and schedule names including ASCII case', async () => {
    mocks.queryRaw.mockResolvedValue([candidate('FINISHED', 'shaft ａ', '2026-05-02')]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([
      { ...purchase, purchasePartName: ' ＳＨＡＦＴ A ' },
    ])).toEqual([new Date('2026-05-02')]);
  });

  it('prefers match key over both an earlier normalized-code date and an earlier name date', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MATCH-001', '別名', '2026-05-03'),
      candidate('MD100492280', '別名', '2026-05-02'),
      candidate('FINISHED', 'シャフト', '2026-05-01'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([
      { ...purchase, purchasePartCodeMatchKey: 'MATCH' },
    ])).toEqual([new Date('2026-05-03')]);
  });

  it('falls back to name when code candidates have no date', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MD100492280', '別名', null),
      candidate('FINISHED', 'シャフト', '2026-05-02'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([purchase])).toEqual([new Date('2026-05-02')]);
  });

  it('does not cross seibans or match empty names/codes', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MD100492280', 'シャフト', '2026-05-01', 'BA2'),
      candidate('', '　', '2026-05-02'),
      candidate('FINISHED', '別名', '2026-05-03'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([
      purchase,
      { ...purchase, purchasePartCodeMatchKey: '', purchasePartCodeNormalized: '', purchasePartName: '' },
    ])).toEqual([null, null]);
  });

  it('fetches all seibans once with an index-friendly predicate and preserves known raw variants', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MD100492280', 'シャフト', '2026-05-02', ' BA1 '),
      candidate('MD100492280', 'シャフト', '2026-05-03', 'BA2'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([
      { ...purchase, seiban: ' BA1 ' }, purchase, { ...purchase, seiban: 'BA2' },
    ])).toEqual([new Date('2026-05-02'), new Date('2026-05-02'), new Date('2026-05-03')]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const [strings, , , seibans, winner] = mocks.queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain(`COALESCE(r."rowData"->>'FSEIBAN', '') = ANY(?::text[])`);
    expect(strings.join('?')).not.toMatch(/trim|regexp_replace/i);
    expect(seibans).toEqual(['BA1', ' BA1 ', 'BA2']);
    expect(winner.sql).toContain('LIMIT 1');
  });

  it('avoids querying for empty orders or blank seibans', async () => {
    expect(await findEarliestPlannedStartDatesForPurchaseRows([])).toEqual([]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([{ ...purchase, seiban: ' ' }])).toEqual([null]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
