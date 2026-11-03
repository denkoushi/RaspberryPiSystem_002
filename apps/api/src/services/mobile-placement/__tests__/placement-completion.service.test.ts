vi.mock('../../../config/env/load-dotenv.js', () => ({}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.query } }));

import { Prisma } from '@prisma/client';

import { filterActivePlacements } from '../placement-completion.service.js';
import { resolvePurchasePlannedStartCandidates } from '../../purchase-order-lookup/purchase-order-lookup-planned-start.service.js';

const order = (productNo: string) => ({ manufacturingOrderBarcodeRaw: productNo, scheduleSnapshot: null });
const purchase = (code = 'MD1(A)-001', name = 'シャフト') => ({
  slipKind: 'purchase_order', manufacturingOrderBarcodeRaw: 'purchase:123', csvDashboardRowId: null,
  scheduleSnapshot: { FSEIBAN: ' BA1 ', FHINCD: code, FHINMEI: name, PurchaseOrderNo: '123' },
});
const candidate = (fhincd: string, fhinmei: string, completed: boolean, productNo = '10') => ({
  seiban: 'BA1', fhincd, fhinmei, productNo, completed, plannedStartDate: new Date('2026-11-01'),
});

beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue([]); });

describe('placement completion', () => {
  it('batches normalized ProductNos, using all processes and the single effective completion source', async () => {
    mocks.query.mockResolvedValue([{ productNo: '001' }]);
    const rows = [order('　001 '), { ...order('001'), slipKind: 'manufacturing_order' }, order('002'), order('missing')];
    expect(await filterActivePlacements(rows)).toEqual(rows.slice(2));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [strings, ...values] = mocks.query.mock.calls[0];
    const sql = Prisma.sql(strings, ...values);
    expect(sql.text).toContain("r.\"rowData\"->>'ProductNo' = ANY(");
    expect(sql.text).toContain("GROUP BY r.\"rowData\"->>'ProductNo'");
    expect(sql.text).toContain('HAVING bool_and((COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE)))');
    expect(sql.text).toContain('LEFT JOIN "ProductionScheduleProgress"');
    expect(sql.text).toContain('LEFT JOIN "ProductionScheduleExternalCompletion"');
    expect(sql.text).not.toMatch(/FKOJUNST|NOT EXISTS|csvDashboardRowId.*ANY/);
    expect(sql.values).toContainEqual(['001', '002', 'missing']);
  });

  it.each([true, false])('uses raw-code normalization and name fallback, completed=%s', async completed => {
    const rows = [purchase(), purchase('unknown'), purchase('unmatched', 'other')];
    mocks.query.mockResolvedValue([candidate('MD1-002', 'シャフト', completed)]);
    expect(await filterActivePlacements(rows)).toEqual(completed ? [rows[2]] : rows);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [strings, ...values] = mocks.query.mock.calls[0];
    expect(Prisma.sql(strings, ...values).values).toContainEqual(['BA1', ' BA1 ']);
  });

  it.each(['match', 'normalized', 'name'] as const)('shares full selected candidate through %s resolution', key => {
    const part = { seiban: 'BA1', purchasePartCodeMatchKey: key === 'match' ? 'MD1' : 'legacy',
      purchasePartCodeNormalized: key === 'normalized' ? 'MD1-001' : 'missing', purchasePartName: 'シャフト' };
    for (const completed of [true, false]) {
      expect(resolvePurchasePlannedStartCandidates([part], [candidate('MD1-001', 'シャフト', completed)]))
        .toEqual([{ productNo: 10n, completed, date: new Date('2026-11-01') }]);
    }
  });

  it('retains unmatched and undated purchases and respects the preferred incomplete process', async () => {
    const rows = [purchase()];
    mocks.query.mockResolvedValue([candidate('MD1', 'シャフト', true), candidate('MD1', 'シャフト', false)]);
    expect(await filterActivePlacements(rows)).toEqual(rows);
    mocks.query.mockResolvedValue([{ ...candidate('MD1', 'シャフト', true), plannedStartDate: null }]);
    expect(await filterActivePlacements(rows)).toEqual(rows);
  });

  it('makes at most one order query and one candidate query for a mixed batch', async () => {
    const rows = Array.from({ length: 100 }, () => [order('001'), purchase()]).flat();
    expect(await filterActivePlacements(rows)).toEqual(rows);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it('does not query for an empty batch', async () => {
    expect(await filterActivePlacements([])).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
