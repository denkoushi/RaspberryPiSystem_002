import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertProductionScheduleSeibanDueDate, upsertProductionScheduleSeibanProcessingDueDate } from '../due-management-command.service.js';
import { upsertProductionScheduleDueDate } from '../production-schedule-command.service.js';

const mocks = vi.hoisted(() => {
  const delegate = () => ({ findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  const tx = {
    csvDashboardRow: { findFirst: vi.fn() },
    productionScheduleRowNote: delegate(),
    productionScheduleSeibanDueDate: delegate(),
    productionScheduleSeibanProcessingDueDate: delegate(),
    productionScheduleDueDateAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn(), $executeRaw: vi.fn()
  };
  return { tx, transaction: vi.fn(), resetCaches: vi.fn() };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('../../part-measurement/self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches: mocks.resetCaches
}));

const before = new Date('2026-11-01T00:00:00.000Z');
const after = new Date('2026-11-10T00:00:00.000Z');
const actor = { locationKey: 'site-key', actorClientDeviceId: 'device', actorDeviceName: 'terminal' };
const cases = [
  { action: 'row', run: (date: string) => upsertProductionScheduleDueDate({ ...actor, rowId: 'row', dueDateText: date }), target: { csvDashboardRowId: 'row' } },
  { action: 'seiban', run: (date: string) => upsertProductionScheduleSeibanDueDate({ ...actor, fseiban: 'ORDER', dueDateText: date }), target: { fseiban: 'ORDER' } },
  { action: 'processing', run: (date: string) => upsertProductionScheduleSeibanProcessingDueDate({ ...actor, fseiban: 'ORDER', processingType: 'paint', dueDateText: date }), target: { fseiban: 'ORDER', processingType: 'paint' } }
];
let committedAudits: unknown[];
beforeEach(() => {
  vi.resetAllMocks();
  committedAudits = [];
  mocks.transaction.mockImplementation(async (callback) => {
    const result = await callback(mocks.tx);
    committedAudits.push(...mocks.tx.productionScheduleDueDateAuditLog.create.mock.calls.map(([arg]) => arg.data));
    return result;
  });
  mocks.tx.csvDashboardRow.findFirst.mockResolvedValue({ id: 'row', rowData: {} });
  mocks.tx.productionScheduleRowNote.findUnique.mockResolvedValue({ dueDate: before, note: '', processingType: null });
  mocks.tx.productionScheduleSeibanDueDate.findUnique.mockResolvedValue({ dueDate: before });
  mocks.tx.productionScheduleSeibanProcessingDueDate.findUnique.mockResolvedValue({ dueDate: before });
  mocks.tx.$queryRaw.mockImplementation(async (query: TemplateStringsArray) => String(query).includes('SELECT EXISTS') ? [{ exists: true }] : String(query).includes('SELECT "processingType"') ? [] : [{ id: 'row' }]);
});

describe.each(cases)('$action due-date audit', ({ action, run, target }) => {
  it.each(['2026-11-10', '', '2026-11-01'])('records one entry with previous value and actor for %s', async (date) => {
    await run(date);
    expect(committedAudits).toEqual([expect.objectContaining({
      action, ...target, location: 'site-key', actorClientDeviceId: 'device', actorDeviceName: 'terminal',
      beforeDueDate: before, afterDueDate: date ? date === '2026-11-10' ? after : before : null
    })]);
    expect(mocks.tx.productionScheduleDueDateAuditLog.create).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.resetCaches).toHaveBeenCalledOnce();
    if (!date && action !== 'processing') expect(mocks.tx.productionScheduleRowNote.deleteMany).toHaveBeenCalled();
    else expect(mocks.tx.productionScheduleRowNote.upsert).toHaveBeenCalled();
  });
  it('does not write an audit when the update fails', async () => {
    mocks.tx.productionScheduleRowNote.upsert.mockRejectedValue(new Error('write failed'));
    await expect(run('2026-11-10')).rejects.toThrow('write failed');
    expect(committedAudits).toEqual([]);
    expect(mocks.tx.productionScheduleDueDateAuditLog.create).not.toHaveBeenCalled();
    expect(mocks.resetCaches).not.toHaveBeenCalled();
  });
  it('propagates an audit failure from the update transaction', async () => {
    mocks.tx.productionScheduleDueDateAuditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(run('2026-11-10')).rejects.toThrow('audit failed');
    expect(committedAudits).toEqual([]);
    expect(mocks.resetCaches).not.toHaveBeenCalled();
  });
});
