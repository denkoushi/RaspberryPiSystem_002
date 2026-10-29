import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));

import { findMasterFhinmeisByMatchKey, findMasterFhinmeisByNormalizedFhinCd } from '../purchase-order-lookup-master-part.service.js';

beforeEach(() => { vi.clearAllMocks(); });
describe('purchase master display dictionaries', () => {
  it('does not add normalized-code groups excluded by the existing exact SQL comparison', async () => {
    mocks.queryRaw.mockResolvedValue([{ normalizedFhinCd: 'MD1 ', fhinmei: 'excluded' }, { normalizedFhinCd: 'MD1', fhinmei: 'kept' }]);
    expect(await findMasterFhinmeisByNormalizedFhinCd()).toEqual({ MD1: 'kept' });
  });
  it.each([
    [findMasterFhinmeisByMatchKey, 'matchKeyFhinCd'],
    [findMasterFhinmeisByNormalizedFhinCd, 'normalizedFhinCd']
  ] as const)('uses the same winner/MIN query for complete and filtered dictionaries (%s)', async (find, field) => {
    mocks.queryRaw.mockResolvedValue([{ [field]: 'MD1', fhinmei: ' 品名 ' }, { [field]: 'MD2', fhinmei: ' ' }]);
    expect(await find()).toEqual({ MD1: '品名', MD2: null });
    const [strings, , , winner, allPredicate] = mocks.queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain('MIN('); expect(strings.join('?')).toContain('GROUP BY 1');
    expect(winner.sql).toContain('LIMIT 1'); expect(allPredicate.sql).toBe('');
    expect(await find([' MD1 ', 'MD1', 'MD2'])).toEqual({ MD1: '品名', MD2: null });
    const predicate = mocks.queryRaw.mock.calls[1][4];
    expect(predicate.sql).toContain(' IN (?,?)'); expect(predicate.values).toEqual(['MD1', 'MD2']);
    expect(await find([])).toEqual({}); expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });
});
