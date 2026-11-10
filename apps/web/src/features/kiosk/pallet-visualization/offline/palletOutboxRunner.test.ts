import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPalletOutboxRunner } from './palletOutboxRunner';

import type { PalletQueueRecord } from './palletOfflineQueueStore';
import type { PalletQueueRequest, PalletRequest } from './palletQueueRequest';

const input: PalletRequest = { route: 'add', machineCd: 'MC', palletNo: 1, body: { machineCd: 'MC', palletNo: 1, manufacturingOrderBarcodeRaw: 'ORDER' } };
function setup() {
  const records: PalletQueueRecord[] = [];
  const store = {
    list: vi.fn(async () => [...records]), prune: vi.fn(),
    fail: vi.fn(async (record: PalletQueueRecord, message: string) => { Object.assign(records.find(item => item.eventKey === record.eventKey)!, { status: 'failed', message }); }),
    add: vi.fn(async request => { records.push({ ...request, eventKey: request.body.eventKey, readAt: request.body.readAt, sequence: records.length + 1, status: 'pending' }); }),
    remove: vi.fn(async key => { records.splice(records.findIndex(record => record.eventKey === key), 1); }),
  };
  const send = vi.fn(async (_request: PalletQueueRequest) => ({ id: 'item' }));
  return { records, store, send, runner: createPalletOutboxRunner(store, send) };
}
function httpError(status: number) {
  return Object.assign(new AxiosError('failed'), { response: { status, data: { message: '登録不可' } } });
}
beforeEach(() => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });
describe('pallet outbox runner', () => {
  it('persists before sending and deletes only after success', async () => {
    const { runner, send, store, records } = setup();
    send.mockImplementation(async () => { expect(records).toHaveLength(1); return { id: 'item' }; });
    await runner.submit(input);
    expect(store.add.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(records).toEqual([]);
  });
  it.each([undefined, 503])('retains stable event identity after failure %s', async status => {
    const { runner, send, records } = setup();
    send.mockRejectedValueOnce(status ? httpError(status) : new AxiosError('network'));
    await runner.submit(input);
    const saved = { ...records[0].body };
    await runner.flush();
    expect(send.mock.calls[1][0].body).toEqual(saved);
    expect(records).toEqual([]);
  });
  it.each([400, 409])('keeps permanent %s as failed, publishes its message once, and sends later work', async status => {
    const { runner, send, records } = setup();
    const messages: string[] = [];
    runner.subscribe((_, failure) => { if (failure) messages.push(failure); });
    send.mockRejectedValueOnce(httpError(status));
    await runner.submit(input);
    await runner.flush();
    expect(records).toMatchObject([{ status: 'failed', message: '登録不可' }]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(messages).toEqual(['登録不可']);
    await runner.submit({ ...input, body: { ...input.body, manufacturingOrderBarcodeRaw: 'NEXT' } });
    expect(send.mock.calls.map(([request]) => request.body.manufacturingOrderBarcodeRaw)).toEqual(['ORDER', 'NEXT']);
    expect(records).toMatchObject([{ status: 'failed' }]);
  });
  it('sends serially without allowing a new submission to overtake pending work', async () => {
    const { runner, send, records } = setup();
    let release!: () => void;
    send.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { id: 'item' }; });
    const first = runner.submit(input);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const second = runner.submit({ ...input, body: { ...input.body, manufacturingOrderBarcodeRaw: 'SECOND' } });
    await vi.waitFor(() => expect(records).toHaveLength(2));
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(send.mock.calls.map(([request]) => request.body.manufacturingOrderBarcodeRaw)).toEqual(['ORDER', 'SECOND']);
    expect(records).toEqual([]);
  });
  it('does not send when durable saving fails', async () => {
    const { runner, store, send } = setup();
    store.add.mockRejectedValueOnce(new Error('quota'));
    await expect(runner.submit(input)).rejects.toThrow('quota');
    expect(send).not.toHaveBeenCalled();
  });
});
