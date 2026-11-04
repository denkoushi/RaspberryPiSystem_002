import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendLoanRequest, type LoanQueueRequest } from './loanQueueRequest';

const api = vi.hoisted(() => ({
  getResolvedClientKey: vi.fn(() => 'client-key-1'),
  borrowItem: vi.fn(async () => 'toolBorrow-result'),
  returnLoan: vi.fn(async () => 'toolReturn-result'),
  borrowMeasuringInstrument: vi.fn(async () => 'instrumentBorrow-result'),
  returnMeasuringInstrument: vi.fn(async () => 'instrumentReturn-result'),
  borrowRiggingGear: vi.fn(async () => 'riggingBorrow-result'),
  returnRiggingGear: vi.fn(async () => 'riggingReturn-result'),
}));
vi.mock('../../../../api/client', () => api);

const meta = { eventKey: '11111111-1111-4111-8111-111111111111', readAt: '2026-11-03T09:00:00.000Z' };
type Sender = Exclude<keyof typeof api, 'getResolvedClientKey'>;
const cases: Array<[LoanQueueRequest, Sender]> = [
  [{ route: 'toolBorrow', body: { itemTagUid: 'TOOL', employeeTagUid: 'EMP', ...meta } }, 'borrowItem'],
  [{ route: 'toolReturn', body: { loanId: 'loan-1', ...meta } }, 'returnLoan'],
  [{ route: 'instrumentBorrow', body: { instrumentTagUid: 'INS', employeeTagUid: 'EMP', ...meta } }, 'borrowMeasuringInstrument'],
  [{ route: 'instrumentReturn', body: { loanId: 'loan-2', ...meta } }, 'returnMeasuringInstrument'],
  [{ route: 'riggingBorrow', body: { riggingTagUid: 'RIG', employeeTagUid: 'EMP', ...meta } }, 'borrowRiggingGear'],
  [{ route: 'riggingReturn', body: { loanId: 'loan-3', ...meta } }, 'returnRiggingGear'],
];

const senders: Sender[] = ['borrowItem', 'returnLoan', 'borrowMeasuringInstrument', 'returnMeasuringInstrument', 'borrowRiggingGear', 'returnRiggingGear'];

beforeEach(() => vi.clearAllMocks());

describe('sendLoanRequest', () => {
  it.each(cases)('%o を対応する API にだけ送り、eventKey/readAt と解決済み clientKey を渡す', async (request, sender) => {
    await expect(sendLoanRequest(request)).resolves.toBe(`${request.route}-result`);
    expect(api[sender]).toHaveBeenCalledExactlyOnceWith(request.body, 'client-key-1');
    expect((api[sender].mock.calls[0] as unknown[])[0]).toMatchObject(meta);
    for (const other of senders.filter(name => name !== sender)) expect(api[other]).not.toHaveBeenCalled();
  });

  it('clientKey は送信のたびに解決し直す', async () => {
    api.getResolvedClientKey.mockReturnValueOnce('first').mockReturnValueOnce('second');
    await sendLoanRequest(cases[1][0]);
    await sendLoanRequest(cases[1][0]);
    expect(api.returnLoan.mock.calls.map(call => (call as unknown[])[1])).toEqual(['first', 'second']);
  });

  it('API の失敗はそのまま呼び出し元（outbox）へ伝える', async () => {
    const error = new Error('network down');
    api.borrowItem.mockRejectedValueOnce(error);
    await expect(sendLoanRequest(cases[0][0])).rejects.toBe(error);
  });
});
