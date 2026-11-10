import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLoanOutboxRunner, isRetryableLoanError } from './loanOutboxRunner';

import type { LoanQueueInput, LoanQueueRecord } from './loanOfflineQueueStore';
import type { Loan } from '../../../../api/types';

vi.mock('./loanQueueRequest', () => ({ sendLoanRequest: vi.fn() }));
const httpError = (status?: number, code?: string) => new AxiosError('failed', code, undefined, undefined,
  status ? { status, data: { code }, headers: {}, statusText: 'failed', config: {} as never } : undefined);
const input = (eventKey: string, readAt: string, route: 'toolBorrow' | 'toolReturn' = 'toolBorrow'): LoanQueueInput => route === 'toolBorrow'
  ? { route, body: { itemTagUid: 'TOOL', employeeTagUid: 'EMPLOYEE', eventKey, readAt } }
  : { route, body: { loanId: 'loan', eventKey, readAt } };
let records: LoanQueueRecord[];
function setup() {
  const store = {
    prune: vi.fn(async () => {}),
    list: vi.fn(async () => [...records].sort((a, b) => a.readAt.localeCompare(b.readAt))),
    add: vi.fn(async (request: LoanQueueInput) => { records.push({ ...request, eventKey: request.body.eventKey, readAt: request.body.readAt, status: 'pending' }); }),
    fail: vi.fn(async (record: LoanQueueRecord, message: string) => { Object.assign(records.find(r => r.eventKey === record.eventKey)!, { status: 'failed', message }); }),
    remove: vi.fn(async (eventKey: string) => { records = records.filter(record => record.eventKey !== eventKey); }),
  };
  const send = vi.fn(async () => ({ id: 'loan' } as Loan));
  return { store, send, runner: createLoanOutboxRunner(store, send) };
}
beforeEach(() => { records = []; vi.stubGlobal('navigator', { onLine: true }); });

describe('loan outbox', () => {
  it.each([httpError(), httpError(undefined, 'ECONNABORTED'), httpError(500), httpError(503)])('durably queues retryable failures with a stable UUID and readAt', async error => {
    const { runner, send, store } = setup();
    const readAt = '2026-11-03T09:00:00.000Z';
    send.mockRejectedValueOnce(error);
    await expect(runner.submit({ route: 'toolBorrow', body: { itemTagUid: 'TOOL', employeeTagUid: 'EMPLOYEE' } }, readAt)).resolves.toBeUndefined();
    const sent = send.mock.calls[0][0];
    expect(sent.body).toMatchObject({ readAt, eventKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(store.add).toHaveBeenCalledWith(sent);
    await runner.flush();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ body: sent.body }));
    expect(records).toEqual([]);
  });
  it.each([400, 401, 403, 404, 408, 409, 422, 429])('propagates HTTP %i without saving', async status => {
    const { runner, send, store } = setup();
    const error = httpError(status);
    send.mockRejectedValueOnce(error);
    await expect(runner.submit({ route: 'toolReturn', body: { loanId: 'loan' } })).rejects.toBe(error);
    expect(store.add).not.toHaveBeenCalled();
  });
  it('does not swallow storage failures or arbitrary/cancellation errors', async () => {
    const { runner, send, store } = setup();
    send.mockRejectedValueOnce(httpError());
    store.add.mockRejectedValueOnce(new Error('quota'));
    await expect(runner.submit({ route: 'toolReturn', body: { loanId: 'loan' } })).rejects.toThrow('quota');
    expect(isRetryableLoanError(new Error('bug'))).toBe(false);
    expect(isRetryableLoanError(httpError(undefined, 'ERR_CANCELED'))).toBe(false);
  });
  it('replays oldest readAt first, serially, and shares concurrent flushes', async () => {
    const { runner, store, send } = setup();
    await store.add(input('newer', '2026-11-03T10:00:00Z'));
    await store.add(input('older', '2026-11-03T09:00:00Z'));
    let release!: () => void;
    send.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ id: 'loan' } as Loan); }));
    const first = runner.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const second = runner.flush();
    expect(first).toBe(second);
    expect(send.mock.calls[0][0].body.eventKey).toBe('older');
    release();
    await first;
    expect(send.mock.calls[1][0].body.eventKey).toBe('newer');
    expect(records).toEqual([]);
  });
  it.each([httpError(), httpError(503)])('blocks later requests when the oldest replay still fails', async error => {
    const { runner, store, send } = setup();
    await store.add(input('older', '2026-11-03T09:00:00Z'));
    await store.add(input('newer', '2026-11-03T10:00:00Z'));
    send.mockRejectedValueOnce(error);
    await runner.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(2);
  });
  it.each(['toolReturn', 'instrumentReturn', 'riggingReturn'] as const)('acknowledges missing/already-returned %s retries without displaying failure', async route => {
    for (const error of [httpError(404), httpError(409, 'LOAN_ALREADY_RETURNED'), httpError(409, 'LOAN_ALREADY_CANCELLED')]) {
      const { runner, store, send } = setup();
      await store.add({ route, body: { loanId: 'loan', eventKey: 'return', readAt: '2026-11-03T09:00:00Z' } });
      const listener = vi.fn();
      runner.subscribe(listener);
      send.mockRejectedValueOnce(error);
      await runner.flush();
      expect(records).toEqual([]);
      expect(store.fail).not.toHaveBeenCalled();
      expect(listener.mock.calls.every(([, failure]) => failure === undefined)).toBe(true);
    }
  });
  it.each([400, 401, 403, 404, 408, 409, 422, 429])('displays HTTP %i replay failures once, removes them and continues', async status => {
    const { runner, store, send } = setup();
    await store.add(input('invalid', '2026-11-03T09:00:00Z'));
    await store.add(input('later', '2026-11-03T10:00:00Z'));
    const listener = vi.fn();
    runner.subscribe(listener);
    const error = httpError(status);
    error.response!.data = { message: 'タグ未登録' };
    send.mockRejectedValueOnce(error);
    await runner.flush();
    expect(records).toEqual([]);
    expect(store.fail).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.filter(([, failure]) => failure)).toEqual([
      [[expect.objectContaining({ eventKey: 'later', status: 'pending' })], 'タグ未登録'],
    ]);
    await runner.flush();
    expect(listener.mock.calls.filter(([, failure]) => failure)).toHaveLength(1);
  });
  it('displays and removes previously failed records without resending', async () => {
    const { runner, store, send } = setup();
    await store.add(input('failed', '2026-11-03T09:00:00Z'));
    await store.fail(records[0], 'タグ未登録');
    const listener = vi.fn();
    runner.subscribe(listener);
    await runner.flush();
    expect(records).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(listener.mock.calls.filter(([, failure]) => failure)).toEqual([[[], 'タグ未登録']]);
  });
  it('does not replay while the browser is offline', async () => {
    const { runner, store, send } = setup();
    await store.add(input('pending', '2026-11-03T09:00:00Z'));
    vi.stubGlobal('navigator', { onLine: false });
    await runner.flush();
    expect(send).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
  });
});
