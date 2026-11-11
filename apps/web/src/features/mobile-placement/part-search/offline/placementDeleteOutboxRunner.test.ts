import { packPlacement } from '@raspi-system/slip-match-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../api/domains/mobile-placement', () => ({ deleteOrderPlacementBranch: vi.fn() }));
vi.mock('../../connectivity', () => ({ mobileRequest: (request: () => Promise<unknown>) => request() }));
vi.mock('../../sync/networkGate', () => ({ canSyncNow: vi.fn() }));
vi.mock('../../sync/syncScheduler', () => ({ requestSync: vi.fn() }));

import { deleteOrderPlacementBranch } from '../../../../api/domains/mobile-placement';
import { createMobileLocalDataStore } from '../../local-data/mobileLocalDataStore';
import { canSyncNow } from '../../sync/networkGate';
import { requestSync } from '../../sync/syncScheduler';

import { createPlacementDeleteOutboxRunner } from './placementDeleteOutboxRunner';
import { createPlacementDeleteQueueStore } from './placementDeleteQueueStore';

export const row = { id: 'branch', manufacturingOrderBarcodeRaw: '001', branchNo: 0, shelfCodeRaw: 'A', updatedAt: '2026-10-28T00:00:00Z',
  fseiban: 'FS1', fhincd: 'MD1', fhinmei: 'テーブル', productNo: '001', machineName: 'DAD3350' };
const snapshot = { version: 'b1', dataUpdatedAt: row.updatedAt, rows: [packPlacement(row)] };
async function setup() {
  const local = createMobileLocalDataStore();
  const queue = createPlacementDeleteQueueStore();
  await local.replace({ placements: snapshot });
  return { local, queue, runner: createPlacementDeleteOutboxRunner(queue, local) };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(canSyncNow).mockReturnValue(false); });
afterEach(() => vi.unstubAllGlobals());

describe('placement delete outbox', () => {
  it('removes locally and persists before any send, with the same memory fallback when IDB cannot open', async () => {
    const { local, queue, runner } = await setup();
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('unavailable'); } });
    const listener = vi.fn(); queue.subscribe(listener);
    await runner.submit(row);
    expect(await local.listPlacements()).toEqual([]);
    expect(await queue.list()).toEqual([expect.objectContaining({ id: row.id, row, status: 'pending' })]);
    expect(listener).toHaveBeenCalled();
    await runner.flush();
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
    expect(await runner.hasPendingWork()).toBe(true);
  });
  it.each([undefined, 500, 503, 408, 429])('retains pending on retryable status %s', async (status) => {
    const { local, queue, runner } = await setup();
    await runner.submit(row);
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: status ? { status } : undefined });
    await runner.flush();
    expect((await queue.list())[0].status).toBe('pending');
    expect(await local.listPlacements()).toEqual([]);
  });
  it.each([400, 401, 403, 422])('restores a row on terminal status %s, retaining needs_check', async (status) => {
    const { local, queue, runner } = await setup();
    await runner.submit(row);
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { status } });
    await runner.flush();
    expect((await queue.list())[0].status).toBe('needs_check');
    expect(await local.listPlacements()).toEqual([row]);
    expect(await runner.hasPendingWork()).toBe(false);
    await runner.flush(); expect(deleteOrderPlacementBranch).toHaveBeenCalledTimes(1);
  });
  it.each([200, 404])('finishes status %s, removes any reinserted row and requests refresh', async (status) => {
    const { local, queue, runner } = await setup();
    await runner.submit(row);
    await local.replace({ placements: snapshot });
    vi.mocked(canSyncNow).mockReturnValue(true);
    if (status === 404) vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { status } });
    else vi.mocked(deleteOrderPlacementBranch).mockResolvedValue({ deleted: row });
    await Promise.all([runner.flush(), runner.flush()]);
    expect(deleteOrderPlacementBranch).toHaveBeenCalledExactlyOnceWith(row.id, row.updatedAt);
    expect(await local.listPlacements()).toEqual([]);
    expect(await queue.list()).toEqual([]);
    expect(requestSync).toHaveBeenCalledWith('placements-refresh');
  });
  it('does not overwrite a newer row when a delete is rejected', async () => {
    const { local, queue, runner } = await setup();
    const restorePlacement = vi.spyOn(local, 'restorePlacement');
    await runner.submit(row);
    await local.replace({ placements: { ...snapshot, rows: [packPlacement({ ...row, shelfCodeRaw: 'B', updatedAt: '2026-10-29T00:00:00Z' })] } });
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    await runner.flush();
    expect(deleteOrderPlacementBranch).toHaveBeenCalledExactlyOnceWith(row.id, row.updatedAt);
    expect(restorePlacement).not.toHaveBeenCalled();
    expect((await local.listPlacements())[0].shelfCodeRaw).toBe('B');
    expect(await queue.list()).toEqual([]);
    expect(await runner.hasPendingWork()).toBe(false);
    expect(requestSync).toHaveBeenCalledWith('placements-refresh');
  });
  it('discards a stale queued delete without restoring the old row on 409', async () => {
    const { local, queue, runner } = await setup();
    // Existing queue records already contain the original row and need no migration.
    await queue.put({ id: row.id, row, queuedAt: row.updatedAt, status: 'pending' });
    await local.removePlacement(row.id);
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    await runner.flush();
    expect(deleteOrderPlacementBranch).toHaveBeenCalledExactlyOnceWith(row.id, row.updatedAt);
    expect(await local.listPlacements()).toEqual([]);
    expect(await queue.list()).toEqual([]);
    expect(await runner.hasPendingWork()).toBe(false);
    expect(requestSync).toHaveBeenCalledWith('placements-refresh');
  });
  it('rechecks the network gate between queued sends', async () => {
    const { queue, runner } = await setup();
    await runner.submit(row); await runner.submit({ ...row, id: 'second' });
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(deleteOrderPlacementBranch).mockImplementation(async () => {
      vi.mocked(canSyncNow).mockReturnValue(false); return { deleted: row };
    });
    await runner.flush();
    expect(deleteOrderPlacementBranch).toHaveBeenCalledTimes(1);
    expect((await queue.list()).map((record) => record.id)).toEqual(['second']);
  });
});
