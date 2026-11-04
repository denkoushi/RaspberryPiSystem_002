import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { loanEventFingerprint, resolveLoanReadAt, runLoanEvent } from '../loan-event.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { transaction: { findFirst: vi.fn() } },
}));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const receivedAt = new Date('2026-11-03T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const eventKey = '22222222-2222-4222-8222-222222222222';

describe('resolveLoanReadAt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('readAt未指定なら受信時刻をeventAtにする', () => {
    expect(resolveLoanReadAt(undefined, receivedAt)).toEqual({ eventAt: receivedAt, receivedAt });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('引数省略時は現在時刻を受信時刻として使う', () => {
    vi.useFakeTimers();
    vi.setSystemTime(receivedAt);
    try {
      expect(resolveLoanReadAt()).toEqual({ eventAt: receivedAt, receivedAt });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['7日前ちょうど', -7 * DAY],
    ['1時間前', -60 * MINUTE],
    ['同時刻', 0],
    ['未来4分59.999秒', 5 * MINUTE - 1],
  ])('許容範囲内(%s)のreadAtはそのまま採用する', (_label, delta) => {
    const readAt = new Date(receivedAt.getTime() + delta);
    expect(resolveLoanReadAt(readAt, receivedAt)).toEqual({ eventAt: readAt, receivedAt });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['未来5分ちょうど', 5 * MINUTE],
    ['未来1時間', 60 * MINUTE],
    ['7日+1ms前', -7 * DAY - 1],
  ])('許容範囲外(%s)のreadAtはサーバ時刻に置き換えて警告する', (_label, delta) => {
    const readAt = new Date(receivedAt.getTime() + delta);
    expect(resolveLoanReadAt(readAt, receivedAt)).toEqual({ eventAt: receivedAt, receivedAt });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { readAt, receivedAt },
      'Loan readAt outside allowed range; using server time',
    );
  });

  it('不正な日付(Invalid Date)はサーバ時刻に置き換える', () => {
    const readAt = new Date('not-a-date');
    expect(resolveLoanReadAt(readAt, receivedAt)).toEqual({ eventAt: receivedAt, receivedAt });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('loanEventFingerprint', () => {
  it('eventKeyとclientIdを除外し、キー順に依存しないsha256を返す', () => {
    const readAt = new Date('2026-11-03T09:00:00Z');
    const a = loanEventFingerprint({ eventKey: 'k1', readAt, note: 'n', clientId: 'c1' } as never, 'BORROW');
    const b = loanEventFingerprint({ note: 'n', readAt, eventKey: 'k2', clientId: 'c2' } as never, 'BORROW');
    expect(a).toBe(b);

    const expected = createHash('sha256')
      .update(JSON.stringify({ operation: 'BORROW', body: { note: 'n', readAt } }))
      .digest('hex');
    expect(a).toBe(expected);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('操作種別や本文が異なれば別の値になる', () => {
    const base = loanEventFingerprint({ note: 'n' } as never, 'BORROW');
    expect(loanEventFingerprint({ note: 'n' } as never, 'RETURN')).not.toBe(base);
    expect(loanEventFingerprint({ note: 'm' } as never, 'BORROW')).not.toBe(base);
    expect(loanEventFingerprint({ readAt: new Date('2026-11-03T09:00:00Z') }, 'BORROW')).not.toBe(
      loanEventFingerprint({ readAt: new Date('2026-11-03T09:00:01Z') }, 'BORROW'),
    );
  });
});

describe('runLoanEvent', () => {
  const findFirst = vi.mocked(prisma.transaction.findFirst);
  const loan = { id: 'loan-1' } as never;

  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('eventKeyが無ければ照会せずexecuteを1回実行する(clientId不要)', async () => {
    const execute = vi.fn().mockResolvedValue(loan);
    await expect(runLoanEvent({}, undefined, 'BORROW', execute)).resolves.toBe(loan);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('eventKeyがあるのにclientIdが無ければ400で、executeしない', async () => {
    const execute = vi.fn();
    await expect(runLoanEvent({ eventKey }, undefined, 'BORROW', execute)).rejects.toMatchObject({ statusCode: 400 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('同一(clientId,eventKey)の既存イベントがあり指紋一致ならexecuteせず既存loanを返す', async () => {
    const input = { eventKey };
    findFirst.mockResolvedValue({ eventFingerprint: loanEventFingerprint(input, 'BORROW'), loan } as never);
    const execute = vi.fn();

    await expect(runLoanEvent(input, 'client-a', 'BORROW', execute)).resolves.toBe(loan);
    expect(execute).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a', eventKey } }));
  });

  it('同じeventKeyでも操作種別が違えば指紋不一致として409 EVENT_KEY_REUSED', async () => {
    const input = { eventKey };
    findFirst.mockResolvedValue({ eventFingerprint: loanEventFingerprint(input, 'BORROW'), loan } as never);
    const execute = vi.fn();

    await expect(runLoanEvent(input, 'client-a', 'RETURN', execute)).rejects.toMatchObject({
      statusCode: 409,
      code: 'EVENT_KEY_REUSED',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('既存イベントがなければexecuteの結果を返す', async () => {
    findFirst.mockResolvedValue(null);
    const execute = vi.fn().mockResolvedValue(loan);
    await expect(runLoanEvent({ eventKey }, 'client-a', 'BORROW', execute)).resolves.toBe(loan);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('既存イベントのloanがnullなら(指紋一致でも)再実行する', async () => {
    const input = { eventKey };
    findFirst.mockResolvedValue({ eventFingerprint: loanEventFingerprint(input, 'BORROW'), loan: null } as never);
    const execute = vi.fn().mockResolvedValue(loan);
    await expect(runLoanEvent(input, 'client-a', 'BORROW', execute)).resolves.toBe(loan);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('並行実行で一意制約違反になった場合は勝者のloanを返す', async () => {
    const input = { eventKey };
    const winner = { id: 'winner' } as never;
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ eventFingerprint: loanEventFingerprint(input, 'BORROW'), loan: winner } as never);
    const execute = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );

    await expect(runLoanEvent(input, 'client-a', 'BORROW', execute)).resolves.toBe(winner);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('409(返却競合など)でも勝者イベントがあればそれを返す', async () => {
    const input = { eventKey };
    const winner = { id: 'winner' } as never;
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ eventFingerprint: loanEventFingerprint(input, 'RETURN'), loan: winner } as never);
    const execute = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', undefined, 'LOAN_STATE_CONFLICT'));

    await expect(runLoanEvent(input, 'client-a', 'RETURN', execute)).resolves.toBe(winner);
  });

  it('409で勝者イベントが無ければ元のエラーを投げる', async () => {
    const conflict = new ApiError(409, 'already', undefined, 'LOAN_ALREADY_RETURNED');
    findFirst.mockResolvedValue(null);
    await expect(runLoanEvent({ eventKey }, 'client-a', 'RETURN', vi.fn().mockRejectedValue(conflict))).rejects.toBe(conflict);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('409以外のエラーでは再照会せずそのまま投げる', async () => {
    const notFound = new ApiError(404, 'missing');
    findFirst.mockResolvedValue(null);
    await expect(runLoanEvent({ eventKey }, 'client-a', 'RETURN', vi.fn().mockRejectedValue(notFound))).rejects.toBe(notFound);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('競合後の再照会で指紋不一致ならEVENT_KEY_REUSEDになる', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ eventFingerprint: 'other', loan } as never);
    const execute = vi.fn().mockRejectedValue(new ApiError(409, 'conflict'));
    await expect(runLoanEvent({ eventKey }, 'client-a', 'BORROW', execute)).rejects.toMatchObject({
      code: 'EVENT_KEY_REUSED',
    });
  });
});
