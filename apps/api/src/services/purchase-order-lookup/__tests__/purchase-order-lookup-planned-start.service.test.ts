import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));

import { findEarliestPlannedStartDatesForPurchaseRows, listPurchasePlannedStartCandidates } from '../purchase-order-lookup-planned-start.service.js';

const purchase = {
  seiban: 'BA1',
  purchasePartCodeMatchKey: 'MD100492280',
  purchasePartCodeNormalized: 'MD100492280',
  purchasePartName: 'シャフト',
};
const candidate = (fhincd: string, fhinmei: string, date: string | null, seiban = 'BA1', productNo = '1', completed = false) => ({
  productNo: /^[0-9]+$/.test(productNo) ? BigInt(productNo).toString() : '-1', completed,
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
    const [strings, completion, , , predicate, winner] = mocks.queryRaw.mock.calls[0];
    expect(predicate.sql).toContain(`COALESCE(r."rowData"->>'FSEIBAN', '') = ANY(?::text[])`);
    expect(strings.join('?')).not.toMatch(/trim|regexp_replace/i);
    expect(predicate.values[0]).toEqual(['BA1', ' BA1 ', 'BA2']);
    expect(strings.join('?')).toContain('LEFT JOIN "ProductionScheduleProgress" AS "p"');
    expect(strings.join('?')).toContain('LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"');
    for (const alias of ['p', 'ext']) {
      expect(strings.join('?')).toContain(`"${alias}"."csvDashboardRowId" = r.id AND "${alias}"."csvDashboardId" = r."csvDashboardId"`);
    }
    expect(strings.join('?')).toContain("THEN (r.\"rowData\"->>'ProductNo')::bigint ELSE -1 END)::text");
    expect(completion.sql).toContain('COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE)');
    expect(winner.sql).toContain('LIMIT 1');
  });

  it.each([
    ['0004047005', '0004151393'], ['9', '10'], ['invalid', '0'],
    ['9007199254740992', '9007199254740993'],
  ])('ignores earlier dates of older numeric orders (%s < %s)', async (older, newer) => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MD100492280', 'シャフト', '2026-05-03', 'BA1', newer),
      candidate('MD100492280', 'シャフト', '2026-05-01', 'BA1', older),
      candidate('MD100492280', 'シャフト', null, 'BA1', '9223372036854775807'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([purchase])).toEqual([new Date('2026-05-03')]);
  });

  it.each([false, true])('prefers incomplete processes regardless of row order (reverse=%s)', async (reverse) => {
    const rows = [
      candidate('MD100492280', 'シャフト', '2026-05-01', 'BA1', '9'),
      candidate('MD100492280', 'シャフト', '2026-05-02', 'BA1', '10', true),
      candidate('MD100492280', 'シャフト', '2026-05-04', 'BA1', '10'),
      candidate('MD100492280', 'シャフト', '2026-05-03', 'BA1', '10'),
    ];
    mocks.queryRaw.mockResolvedValue(reverse ? rows.reverse() : rows);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([purchase])).toEqual([new Date('2026-05-03')]);
  });

  it('returns the earliest latest-order date when all its processes are completed', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MD100492280', 'シャフト', '2026-05-01', 'BA1', '9'),
      candidate('MD100492280', 'シャフト', '2026-05-04', 'BA1', '10', true),
      candidate('MD100492280', 'シャフト', '2026-05-03', 'BA1', '10', true),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([purchase])).toEqual([new Date('2026-05-03')]);
  });

  it('selects the latest order independently for each map key and keeps fallback precedence', async () => {
    mocks.queryRaw.mockResolvedValue([
      candidate('MATCH-001', '別名', '2026-05-03', 'BA1', '2'),
      candidate('MATCH-002', '別名', '2026-05-01', 'BA1', '1'),
      candidate('MD100492280(A)', '別名', '2026-05-04', 'BA1', '10'),
      candidate('MD100492280(B)', '別名', '2026-05-02', 'BA1', '9'),
      candidate('FINISHED', 'シャフト', '2026-05-06', 'BA1', '20'),
      candidate('OTHER', 'シャフト', '2026-05-05', 'BA1', '19'),
    ]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([
      { ...purchase, purchasePartCodeMatchKey: 'MATCH' },
      { ...purchase, purchasePartCodeMatchKey: 'LEGACY' },
      { ...purchase, purchasePartCodeMatchKey: '', purchasePartCodeNormalized: '' },
    ])).toEqual(['2026-05-03', '2026-05-04', '2026-05-06'].map((date) => new Date(date)));
  });


  it('exports full date candidates from the same winner and dashboard without a purchase dependency', async () => {
    const rows = [candidate('MD1', 'Part', '2026-11-01')];
    mocks.queryRaw.mockResolvedValue(rows);
    expect(await listPurchasePlannedStartCandidates()).toEqual(rows);
    const [strings, , dashboard, supplementDashboard, predicate, winner] = mocks.queryRaw.mock.calls[0];
    expect(dashboard).toBe(supplementDashboard);
    expect(strings.join('?')).toContain('INNER JOIN "ProductionScheduleOrderSupplement"');
    expect(predicate.sql).toBe(''); expect(winner.sql).toContain('LIMIT 1');
  });
  it('avoids querying for empty orders or blank seibans', async () => {
    expect(await findEarliestPlannedStartDatesForPurchaseRows([])).toEqual([]);
    expect(await findEarliestPlannedStartDatesForPurchaseRows([{ ...purchase, seiban: ' ' }])).toEqual([null]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
