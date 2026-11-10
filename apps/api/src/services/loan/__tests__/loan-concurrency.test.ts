import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import {
  activeLoanConflict,
  claimActiveLoanTransition,
  createActiveLoan,
  isUniqueConstraintViolation,
  mapActiveLoanCreateError,
  type LoanTransactionClient,
} from '../loan-concurrency.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));

const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
const p2025 = () => new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: 'test' });

function makeTx() {
  return {
    loan: { updateMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  };
}

describe('isUniqueConstraintViolation', () => {
  it('detects only Prisma P2002 errors', () => {
    expect(isUniqueConstraintViolation(p2002())).toBe(true);
    expect(isUniqueConstraintViolation(p2025())).toBe(false);
    expect(isUniqueConstraintViolation(new Error('P2002'))).toBe(false);
    expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
  });
});

describe('activeLoanConflict / mapActiveLoanCreateError', () => {
  it('builds a 409 ASSET_ALREADY_ON_LOAN with default and custom messages', () => {
    expect(activeLoanConflict()).toMatchObject({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN', message: 'この資産はすでに貸出中です' });
    expect(activeLoanConflict('工具は貸出中')).toMatchObject({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN', message: '工具は貸出中' });
  });

  it('translates P2002 into the active-loan conflict and rethrows anything else unchanged', () => {
    expect(() => mapActiveLoanCreateError(p2002(), '計測機器は貸出中')).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN', message: '計測機器は貸出中' }),
    );
    const other = p2025();
    let thrown: unknown;
    try {
      mapActiveLoanCreateError(other);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(other);
  });
});

describe('createActiveLoan', () => {
  it('returns the created loan when the unique active-loan index accepts it', async () => {
    const tx = makeTx();
    tx.loan.create.mockResolvedValue({ id: 'loan-1' });
    const args = { data: { employeeId: 'e', itemId: 'i' } } as never;
    await expect(createActiveLoan(tx as unknown as LoanTransactionClient, args)).resolves.toEqual({ id: 'loan-1' });
    expect(tx.loan.create).toHaveBeenCalledWith(args);
  });

  it('maps a concurrent duplicate active loan (P2002) to 409 with the given message', async () => {
    const tx = makeTx();
    tx.loan.create.mockRejectedValue(p2002());
    await expect(createActiveLoan(tx as unknown as LoanTransactionClient, { data: {} } as never, '吊具は貸出中')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSET_ALREADY_ON_LOAN',
      message: '吊具は貸出中',
    });
  });

  it('does not hide unrelated database errors', async () => {
    const tx = makeTx();
    const failure = new Error('connection lost');
    tx.loan.create.mockRejectedValue(failure);
    await expect(createActiveLoan(tx as unknown as LoanTransactionClient, { data: {} } as never)).rejects.toBe(failure);
  });
});

describe('claimActiveLoanTransition', () => {
  let tx: ReturnType<typeof makeTx>;
  const data = { returnedAt: new Date('2026-11-03T10:00:00Z') };
  const claim = (transition: 'RETURN' | 'CANCEL') =>
    claimActiveLoanTransition({ tx: tx as unknown as LoanTransactionClient, loanId: 'loan-1', transition, data });

  beforeEach(() => {
    tx = makeTx();
  });

  it('claims only a loan that is neither returned nor cancelled and skips the follow-up lookup on success', async () => {
    tx.loan.updateMany.mockResolvedValue({ count: 1 });
    await expect(claim('RETURN')).resolves.toBeUndefined();
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { id: 'loan-1', returnedAt: null, cancelledAt: null },
      data,
    });
    expect(tx.loan.findUnique).not.toHaveBeenCalled();
  });

  it('reports 404 when the loan disappeared', async () => {
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    tx.loan.findUnique.mockResolvedValue(null);
    await expect(claim('RETURN')).rejects.toMatchObject({ statusCode: 404, message: '貸出レコードが見つかりません' });
    expect(tx.loan.findUnique).toHaveBeenCalledWith({
      where: { id: 'loan-1' },
      select: { returnedAt: true, cancelledAt: true },
    });
  });

  it.each(['RETURN', 'CANCEL'] as const)('reports LOAN_ALREADY_RETURNED for a %s on a returned loan', async (transition) => {
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    tx.loan.findUnique.mockResolvedValue({ returnedAt: new Date(), cancelledAt: null });
    await expect(claim(transition)).rejects.toMatchObject({ statusCode: 409, code: 'LOAN_ALREADY_RETURNED', message: 'すでに返却済みです' });
  });

  it.each(['RETURN', 'CANCEL'] as const)('reports LOAN_ALREADY_CANCELLED for a %s on a cancelled loan', async (transition) => {
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    tx.loan.findUnique.mockResolvedValue({ returnedAt: null, cancelledAt: new Date() });
    await expect(claim(transition)).rejects.toMatchObject({ statusCode: 409, code: 'LOAN_ALREADY_CANCELLED', message: 'すでに取消済みです' });
  });

  it('prefers the returned state when both terminal timestamps are set', async () => {
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    tx.loan.findUnique.mockResolvedValue({ returnedAt: new Date(), cancelledAt: new Date() });
    await expect(claim('CANCEL')).rejects.toMatchObject({ code: 'LOAN_ALREADY_RETURNED' });
  });

  it.each([
    ['RETURN', '貸出状態が変更されたため返却できません'],
    ['CANCEL', '貸出状態が変更されたため取消できません'],
  ] as const)('reports LOAN_STATE_CONFLICT for %s when the row is still active but the claim lost', async (transition, message) => {
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    tx.loan.findUnique.mockResolvedValue({ returnedAt: null, cancelledAt: null });
    const error = await claim(transition).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 409, code: 'LOAN_STATE_CONFLICT', message });
  });

  it('treats an unexpected multi-row update as a lost claim rather than success', async () => {
    tx.loan.updateMany.mockResolvedValue({ count: 2 });
    tx.loan.findUnique.mockResolvedValue({ returnedAt: null, cancelledAt: null });
    await expect(claim('RETURN')).rejects.toMatchObject({ code: 'LOAN_STATE_CONFLICT' });
  });
});
