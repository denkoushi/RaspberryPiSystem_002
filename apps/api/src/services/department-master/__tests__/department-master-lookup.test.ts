import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../../../lib/prisma.js', () => ({ prisma: { departmentMasterEntry: { findMany } } }));

const { findDepartmentMasterEntries } = await import('../department-master-lookup.js');
const { toJstDate } = await import('../../../lib/jst-date.js');

describe('findDepartmentMasterEntries', () => {
  beforeEach(() => findMany.mockReset());

  it('does not touch the DB for an empty list', async () => {
    expect((await findDepartmentMasterEntries([], new Date())).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('uses the JST date, boundaries inclusive, in one query', async () => {
    findMany.mockResolvedValue([
      { code: 'TEST01', name: 'テスト部署', kanaName: null, unitType: 'C', isSupplier: false, isCustomer: false }
    ]);
    // 2023-03-14T15:00:00Z は日本時間の 2023-03-15 0:00
    const map = await findDepartmentMasterEntries(['TEST01', 'TEST99'], new Date('2023-03-14T15:00:00Z'));
    expect(findMany).toHaveBeenCalledTimes(1);
    const day = new Date('2023-03-15T00:00:00Z');
    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      code: { in: ['TEST01', 'TEST99'] },
      validFrom: { lte: day },
      validTo: { gte: day }
    });
    expect(map.get('TEST01')?.name).toBe('テスト部署');
    expect(map.has('TEST99')).toBe(false);
  });

  it('toJstDate rolls over at JST midnight', () => {
    expect(toJstDate(new Date('2023-03-14T14:59:59Z')).toISOString()).toBe('2023-03-14T00:00:00.000Z');
    expect(toJstDate(new Date('2023-03-14T15:00:00Z')).toISOString()).toBe('2023-03-15T00:00:00.000Z');
  });
});
