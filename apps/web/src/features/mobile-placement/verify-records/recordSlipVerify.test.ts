import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyLocalFirst } from '../local-data/localFirstLookup';
import { useMobilePlacementPageState } from '../useMobilePlacementPageState';

import { createSlipVerifyRecorder } from './recordSlipVerify';
import { createVerifyRecordStore, verifyRecordStore } from './verifyRecordStore';

vi.mock('../sync/syncScheduler', () => ({ requestSync: vi.fn() }));
vi.mock('../local-data/localFirstLookup', () => ({ verifyLocalFirst: vi.fn() }));
vi.mock('../../../api/client', () => ({ verifyMobilePlacementSlipMatch: vi.fn() }));
const input = { transferOrderBarcodeRaw: '0002178005', transferPartBarcodeRaw: '', actualOrderBarcodeRaw: '4501238876', actualFseibanRaw: '', actualPartBarcodeRaw: '' };
const match = { ok: true, reason: 'match' as const, expected: { fseiban: 'FS1', fhincd: 'P1', partName: '部品' }, actual: { fseiban: 'FS1', partCode: 'P1' } };
beforeEach(async () => {
  vi.resetAllMocks();
  for (const record of await verifyRecordStore.list()) await verifyRecordStore.remove(record);
});
describe('verify recording', () => {
  it('records the same input and outcome once and a changed outcome again', async () => {
    const store = createVerifyRecordStore();
    const recorder = createSlipVerifyRecorder(store);
    await recorder.record(input, match);
    await recorder.record(input, match);
    expect(await store.list()).toHaveLength(1);
    await recorder.record(input, { ok: false, reason: 'different_part' });
    expect((await store.list()).map(record => record.outcome)).toEqual(['match', 'mismatch']);
    await recorder.record({ ...input, actualPartBarcodeRaw: 'new' }, match);
    expect(await store.list()).toHaveLength(3);
  });
  it.each(['part_required', 'order_not_found', 'transfer_not_found'] as const)('records %s as not_found', async (reason) => {
    const store = createVerifyRecordStore();
    await createSlipVerifyRecorder(store).record(input, { ok: false, reason });
    expect((await store.list())[0]).toMatchObject({ outcome: 'not_found', reason });
  });
  it.each([false, true])('links the last current-input record, already uploaded: %s', async (uploaded) => {
    const store = createVerifyRecordStore();
    const recorder = createSlipVerifyRecorder(store);
    await recorder.record(input, match);
    const [record] = await store.list();
    if (uploaded) await store.remove(record);
    await recorder.link({ ...input, actualOrderBarcodeRaw: 'other' }, 'wrong');
    expect((await store.list())[0]?.clientRecordId).toBeUndefined();
    await recorder.link(input, 'placement');
    expect(await store.list()).toEqual([{ ...record, clientRecordId: 'placement' }]);
  });
  it('records from runSlipVerify only after completion, including thrown errors', async () => {
    let finish!: (value: typeof match) => void;
    vi.mocked(verifyLocalFirst).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const client = new QueryClient();
    const { result } = renderHook(() => useMobilePlacementPageState(), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
    });
    act(() => { result.current.setTransferOrder(input.transferOrderBarcodeRaw); result.current.setActualOrder(input.actualOrderBarcodeRaw); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.runSlipVerify(); });
    expect(result.current.slipVerifying).toBe(true);
    expect(await verifyRecordStore.list()).toEqual([]);
    await act(async () => { finish(match); await pending; });
    expect((await verifyRecordStore.list())[0]).toMatchObject({ outcome: 'match', expectedPartName: '部品', actualPartCode: 'P1' });
    vi.mocked(verifyLocalFirst).mockResolvedValue(match);
    await act(async () => { await result.current.runSlipVerify(); });
    expect(await verifyRecordStore.list()).toHaveLength(1);
    vi.mocked(verifyLocalFirst).mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.runSlipVerify(); });
    expect((await verifyRecordStore.list()).map(record => record.outcome)).toEqual(['match', 'error']);
    expect(result.current.slipResult).toBe('error');
  });
});
