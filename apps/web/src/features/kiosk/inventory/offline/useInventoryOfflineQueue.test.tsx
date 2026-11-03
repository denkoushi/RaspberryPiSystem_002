import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryOfflineQueue } from './useInventoryOfflineQueue';

import type { InventoryQueueRecord } from './inventoryOfflineQueueStore';

const runner = vi.hoisted(() => ({ refresh: vi.fn(), subscribe: vi.fn() }));
vi.mock('./inventoryOutboxRunner', () => ({ inventoryOutboxRunner: () => runner }));
let onRecords: (records: InventoryQueueRecord[]) => void;
const unsubscribe = vi.fn();
const record: InventoryQueueRecord = { route: 'touchTransaction', body: { compartmentId: 'drawer', quantity: 2, idempotencyKey: 'key' },
  idempotencyKey: 'key', createdAt: '2026-11-02T00:00:00Z', status: 'pending' };
function mount() {
  const setMessage = vi.fn();
  const setMessageKind = vi.fn();
  return { setMessage, setMessageKind,
    ...renderHook(() => useInventoryOfflineQueue(setMessage, setMessageKind)) };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  runner.refresh.mockResolvedValue([]);
  runner.subscribe.mockImplementation(listener => { onRecords = listener; return unsubscribe; });
});
afterEach(() => { vi.useRealTimers(); });

describe('inventory automatic replay lifecycle', () => {
  it('refreshes and subscribes only while the inventory screen is mounted', () => {
    const { unmount } = mount();
    expect(runner.refresh).toHaveBeenCalledOnce();
    expect(runner.subscribe).toHaveBeenCalledOnce();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('displays pending and durable failure counts, including restored failures', () => {
    const { setMessage, setMessageKind } = mount();
    onRecords([record, { ...record, idempotencyKey: 'bad', status: 'failed' }]);
    expect(setMessage).toHaveBeenLastCalledWith('未送信 1 件・失敗 1 件');
    expect(setMessageKind).toHaveBeenLastCalledWith('error');
    onRecords([{ ...record, status: 'failed' }]);
    expect(setMessage).toHaveBeenLastCalledWith('未送信 0 件・失敗 1 件');
    onRecords([]);
    expect(setMessage).toHaveBeenLastCalledWith('未送信 0 件・失敗 1 件');
  });
  it('does not overwrite operation messages on unchanged polling counts or an empty mount', () => {
    const { setMessage } = mount();
    onRecords([]);
    expect(setMessage).not.toHaveBeenCalled();
    onRecords([record]);
    onRecords([record]);
    expect(setMessage).toHaveBeenCalledTimes(1);
  });
  it('surfaces storage failures instead of silently ignoring them', async () => {
    runner.refresh.mockRejectedValue(new Error('読込失敗'));
    const { setMessage, setMessageKind } = mount();
    await act(async () => {});
    expect(setMessage).toHaveBeenCalledWith('読込失敗');
    expect(setMessageKind).toHaveBeenCalledWith('error');
  });
});
