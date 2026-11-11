import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { dueManagementLearningEventRepository } from '../due-management-learning-event.repository.js';
import { assignProductionScheduleOrderInTransaction, autoRankProductionScheduleOrder } from '../production-schedule-auto-rank.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../due-management-learning-event.repository.js', () => ({
  dueManagementLearningEventRepository: { saveOutcomeEvent: vi.fn() }
}));

type Assignment = { csvDashboardRowId: string; location: string; siteKey: string; resourceCd: string; orderNumber: number };
let committed: Assignment[];
let events: unknown[];
let rowResources: Record<string, string>;
let locks: unknown[][];
let writes: Assignment[];
const request = { resourceCd: '305', locationKey: '第2工場', actorLocationKey: 'actor', assignments: [
  { rowId: 'b', orderNumber: 2 }, { rowId: 'a', orderNumber: 1 }
] };

beforeEach(() => {
  vi.clearAllMocks();
  committed = []; events = []; locks = []; writes = []; rowResources = { a: '305', b: '305' };
  // An isolated transactional working copy: only a fulfilled callback commits writes/events.
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    let pending = structuredClone(committed);
    const pendingEvents: unknown[] = [];
    const tx = {
      $executeRaw: vi.fn(async (...args: unknown[]) => { locks.push(args); return 1; }),
      csvDashboardRow: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        expect(locks.length).toBeGreaterThan(0);
        return where.id in rowResources ? { id: where.id, rowData: { FSIGENCD: rowResources[where.id], FSEIBAN: ' S1 ' } } : null;
      }) },
      productionScheduleOrderAssignment: {
        findUnique: vi.fn(async ({ where }: { where: { csvDashboardRowId_location: { csvDashboardRowId: string; location: string } } }) =>
          pending.find(a => a.csvDashboardRowId === where.csvDashboardRowId_location.csvDashboardRowId && a.location === where.csvDashboardRowId_location.location) ?? null),
        findFirst: vi.fn(async ({ where }: { where: Omit<Partial<Assignment>, 'csvDashboardRowId'> & { csvDashboardRowId: string | { not: string } } }) =>
          pending.find(a => (typeof where.csvDashboardRowId === 'string' ? a.csvDashboardRowId === where.csvDashboardRowId : a.csvDashboardRowId !== where.csvDashboardRowId.not) && (!where.resourceCd || a.resourceCd === where.resourceCd) && (where.orderNumber === undefined || a.orderNumber === where.orderNumber) &&
            (where.location ? a.location === where.location : a.siteKey === where.siteKey)) ?? null),
        upsert: vi.fn(async ({ create }: { create: Assignment }) => {
          writes.push(create);
          pending = pending.filter(a => !(a.csvDashboardRowId === create.csvDashboardRowId && a.location === create.location));
          pending.push(create);
        }),
        deleteMany: vi.fn(async ({ where }: { where: { csvDashboardRowId: string; siteKey: string; location: { not: string } } }) => {
          pending = pending.filter(a => !(a.csvDashboardRowId === where.csvDashboardRowId && a.siteKey === where.siteKey && a.location !== where.location.not));
        })
      },
      dueManagementOutcomeEvent: { create: vi.fn(async ({ data }: { data: unknown }) => { pendingEvents.push(data); }) }
    };
    vi.mocked(dueManagementLearningEventRepository.saveOutcomeEvent).mockImplementation(async (input, db) => {
      expect(db).toBe(tx);
      await db!.dueManagementOutcomeEvent.create({ data: input } as never);
    });
    const result = await callback(tx as unknown as Prisma.TransactionClient);
    committed = pending; events.push(...pendingEvents);
    return result;
  }) as never);
});

describe('atomic auto rank', () => {
  it('commits all assignments and learning events while preserving another site', async () => {
    committed = [{ csvDashboardRowId: 'a', location: '別工場 - kioskA', siteKey: '別工場', resourceCd: '305', orderNumber: 4 }];
    await expect(autoRankProductionScheduleOrder(request)).resolves.toEqual({ success: true, assignments: request.assignments });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(committed.map(a => [a.csvDashboardRowId, a.location, a.orderNumber])).toEqual([['a', '別工場 - kioskA', 4], ['a', '第2工場', 1], ['b', '第2工場', 2]]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ csvDashboardRowId: 'a', fseiban: 'S1', metadata: { actorLocation: 'actor', nextOrderNumber: 1 } });
    expect(writes.map(a => a.csvDashboardRowId)).toEqual(['a', 'b']);
  });

  it('accepts the same request twice without more writes or events', async () => {
    await autoRankProductionScheduleOrder(request);
    const before = structuredClone(committed);
    await expect(autoRankProductionScheduleOrder(request)).resolves.toMatchObject({ success: true });
    expect(committed).toEqual(before);
    expect(writes).toHaveLength(2);
    expect(events).toHaveLength(2);
  });

  it('accepts matching legacy device assignments without normalizing or recording events', async () => {
    committed = request.assignments.map(({ rowId, orderNumber }) => ({
      csvDashboardRowId: rowId, orderNumber, resourceCd: '305', siteKey: '第2工場', location: '第2工場 - kioskA'
    }));
    const before = structuredClone(committed);
    await expect(autoRankProductionScheduleOrder(request)).resolves.toMatchObject({ success: true });
    expect(committed).toEqual(before);
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });

  it('rejects a different resource even if the order number matches', async () => {
    committed = [{ csvDashboardRowId: 'b', location: '第2工場 - kioskA', siteKey: '第2工場', resourceCd: 'other', orderNumber: 2 }];
    const before = structuredClone(committed);
    await expect(autoRankProductionScheduleOrder(request)).rejects.toMatchObject({ statusCode: 409, code: 'AUTO_RANK_ROW_ALREADY_ASSIGNED' });
    expect(committed).toEqual(before);
    expect(events).toEqual([]);
  });

  it('rolls back earlier assignments and learning events when a later slot conflicts', async () => {
    committed = [
      { csvDashboardRowId: 'a', location: '別工場 - kioskA', siteKey: '別工場', resourceCd: '305', orderNumber: 4 },
      { csvDashboardRowId: 'other', location: '第2工場', siteKey: '第2工場', resourceCd: '305', orderNumber: 2 }
    ];
    const before = structuredClone(committed);
    await expect(autoRankProductionScheduleOrder(request)).rejects.toMatchObject({ statusCode: 409, code: 'ORDER_NUMBER_CONFLICT' });
    expect(writes).toHaveLength(1); // Failure really occurs after an earlier write.
    expect(committed).toEqual(before);
    expect(events).toEqual([]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a legacy device rank visible through the canonical site fallback', async () => {
    committed = [{ csvDashboardRowId: 'b', location: '第2工場 - kioskA', siteKey: '第2工場', resourceCd: '305', orderNumber: 8 }];
    const before = structuredClone(committed);
    await expect(autoRankProductionScheduleOrder(request)).rejects.toMatchObject({ statusCode: 409, code: 'AUTO_RANK_ROW_ALREADY_ASSIGNED' });
    expect(writes).toHaveLength(1);
    expect(committed).toEqual(before);
    expect(events).toEqual([]);
  });

  it('preserves a manual rank assigned after planning and rolls back the earlier row', async () => {
    committed = [{ csvDashboardRowId: 'b', location: '第2工場', siteKey: '第2工場', resourceCd: '305', orderNumber: 8 }];
    const before = structuredClone(committed);
    await expect(autoRankProductionScheduleOrder(request)).rejects.toMatchObject({ statusCode: 409, code: 'AUTO_RANK_ROW_ALREADY_ASSIGNED' });
    expect(writes).toHaveLength(1);
    expect(committed).toEqual(before); expect(events).toEqual([]);
  });

  it.each(['missing', 'resource'])('rolls back on a later %s row', async (failure) => {
    if (failure === 'missing') delete rowResources.b; else rowResources.b = 'other';
    await expect(autoRankProductionScheduleOrder(request)).rejects.toMatchObject({ statusCode: failure === 'missing' ? 404 : 400 });
    expect(writes).toHaveLength(1); expect(committed).toEqual([]); expect(events).toEqual([]);
  });

  it('takes the same parent and slot locks in the same order for reversed plans', async () => {
    await autoRankProductionScheduleOrder(request);
    const firstLocks = locks.slice(0, 4);
    committed = []; locks = [];
    await autoRankProductionScheduleOrder({ ...request, assignments: [...request.assignments].reverse() });
    expect(locks.slice(0, 4)).toEqual(firstLocks);
    expect(locks.slice(0, 4).every(args => String(args[0]).includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('rolls back assignments if learning event recording fails', async () => {
    vi.mocked(dueManagementLearningEventRepository.saveOutcomeEvent).mockRejectedValueOnce(new Error('event failed'));
    await expect(autoRankProductionScheduleOrder(request)).rejects.toThrow('event failed');
    expect(committed).toEqual([]); expect(events).toEqual([]);
  });
  it('allows the single-save helper to overwrite a rank and records the previous value', async () => {
    committed = [{ csvDashboardRowId: 'a', location: '第2工場', siteKey: '第2工場', resourceCd: '305', orderNumber: 8 }];
    await prisma.$transaction(tx => assignProductionScheduleOrderInTransaction(tx, {
      rowId: 'a', resourceCd: '305', orderNumber: 1, locationKey: '第2工場', actorLocationKey: 'actor'
    }));
    expect(committed).toHaveLength(1);
    expect(committed[0].orderNumber).toBe(1);
    expect(events[0]).toMatchObject({ metadata: { previousOrderNumber: 8, nextOrderNumber: 1, reorderDelta: -7 } });
  });

});
