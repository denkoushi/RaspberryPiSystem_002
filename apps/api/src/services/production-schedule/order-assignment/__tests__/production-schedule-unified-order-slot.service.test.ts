import { describe, expect, it, vi } from 'vitest';

import {
  acquireUnifiedOrderSlotLocksInTransaction,
  assertUnifiedOrderSlotAvailableInTransaction,
  sortUnifiedOrderSlots
} from '../production-schedule-unified-order-slot.service.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../production-schedule-parent-row-lock.service.js';

describe('parent order slot assignment', () => {
  it.each([0, 1])('returns 409 for an occupied location or fallback slot (%s)', async (conflictAt) => {
    const findFirst = vi.fn().mockResolvedValueOnce(conflictAt === 0 ? { id: 'occupied' } : null)
      .mockResolvedValueOnce({ id: 'occupied' });
    await expect(assertUnifiedOrderSlotAvailableInTransaction({ productionScheduleOrderAssignment: { findFirst } } as never,
      { locationKey: 'site', resourceCd: '080', orderNumber: 2, excludeParentRowId: 'parent' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'ORDER_NUMBER_CONFLICT' });
    expect(findFirst).toHaveBeenCalledTimes(conflictAt + 1);
    expect(findFirst.mock.calls[conflictAt][0].where).toMatchObject(conflictAt === 0 ? { location: 'site' } : { siteKey: 'site' });
    expect(findFirst.mock.calls[0][0].where.csvDashboardRowId).toEqual({ not: 'parent' });
  });

  it('ignores retained legacy assignments while accepting a free parent slot', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const legacyFindFirst = vi.fn().mockResolvedValue({ id: 'legacy' });
    await expect(assertUnifiedOrderSlotAvailableInTransaction({
      productionScheduleOrderAssignment: { findFirst },
      productionScheduleOrderSplitAssignment: { findFirst: legacyFindFirst }
    } as never, { locationKey: 'site', resourceCd: '080', orderNumber: 2 })).resolves.toBeUndefined();
    expect(legacyFindFirst).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('keeps parent and slot advisory locks stable and deduplicates slots in fixed order', async () => {
    const slots = [{ locationKey: 'site', resourceCd: '080', orderNumber: 2 },
      { locationKey: 'site', resourceCd: ' 080 ', orderNumber: 1 },
      { locationKey: 'site', resourceCd: '080', orderNumber: 2 }];
    expect(sortUnifiedOrderSlots(slots).map((slot) => slot.orderNumber)).toEqual([1, 2]);
    const execute = vi.fn().mockResolvedValue(0);
    const tx = { $executeRaw: execute };
    await acquireProductionScheduleParentRowLockInTransaction(tx as never, 'parent');
    await acquireProductionScheduleParentRowLockInTransaction(tx as never, 'parent');
    expect(execute.mock.calls[0][1]).toBe(execute.mock.calls[1][1]);
    await acquireUnifiedOrderSlotLocksInTransaction(tx as never, slots);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.every(([sql]) => sql.join('').includes('pg_advisory_xact_lock'))).toBe(true);
  });
});
