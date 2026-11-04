import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  executeAssetBorrowTransaction,
  executeAssetReturnTransaction,
  findActiveLoanForAsset,
} from '../loan-transaction.helpers.js';

const tx = vi.hoisted(() => ({
  loan: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn() },
  transaction: { create: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: { ...tx, $transaction: vi.fn() } }));

const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
const calls: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  vi.mocked(prisma.$transaction).mockImplementation((async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) as never);
  tx.loan.create.mockImplementation(async () => { calls.push('loan.create'); return { id: 'loan-1' }; });
  tx.loan.updateMany.mockImplementation(async () => { calls.push('loan.claim'); return { count: 1 }; });
  tx.loan.findUniqueOrThrow.mockImplementation(async () => { calls.push('loan.reload'); return { id: 'loan-1', returnedAt: new Date() }; });
  tx.transaction.create.mockImplementation(async () => { calls.push('transaction.create'); return { id: 't' }; });
});

describe('findActiveLoanForAsset', () => {
  it('only matches loans that are neither returned nor cancelled for the given asset FK', async () => {
    tx.loan.findFirst.mockResolvedValue(null);
    await findActiveLoanForAsset({ assetFkField: 'riggingGearId', assetId: 'rg-1' });
    expect(tx.loan.findFirst).toHaveBeenCalledWith({ where: { riggingGearId: 'rg-1', returnedAt: null, cancelledAt: null } });
  });
});

describe('executeAssetBorrowTransaction', () => {
  it('creates the loan, marks the asset in use, runs afterCreate, then records the transaction from the created loan', async () => {
    const setAssetInUse = vi.fn(async () => { calls.push('asset.inUse'); });
    const afterCreate = vi.fn(async () => { calls.push('afterCreate'); });
    const buildTransactionCreateData = vi.fn((loan: { id: string }) => ({ loanId: loan.id, action: 'BORROW' as const }));
    const loanCreate = {
      data: { employeeId: 'e', measuringInstrumentId: 'mi' } as never,
      include: { employee: true, measuringInstrument: true },
    };
    const result = await executeAssetBorrowTransaction({
      loanCreate,
      setAssetInUse,
      afterCreate,
      buildTransactionCreateData,
    });
    expect(result).toEqual({ id: 'loan-1' });
    expect(tx.loan.create).toHaveBeenCalledTimes(1);
    expect(tx.loan.create).toHaveBeenCalledWith({
      data: { employeeId: 'e', measuringInstrumentId: 'mi' },
      include: { employee: true, measuringInstrument: true },
    });
    expect(setAssetInUse).toHaveBeenCalledWith(tx);
    expect(buildTransactionCreateData).toHaveBeenCalledWith({ id: 'loan-1' });
    expect(calls).toEqual(['loan.create', 'asset.inUse', 'afterCreate', 'transaction.create']);
    expect(afterCreate).toHaveBeenCalledWith(tx, { id: 'loan-1' });
    expect(tx.transaction.create).toHaveBeenCalledWith({ data: { loanId: 'loan-1', action: 'BORROW' } });
  });

  it('maps a unique violation from loan.create to ASSET_ALREADY_ON_LOAN', async () => {
    tx.loan.create.mockRejectedValue(p2002());
    const setAssetInUse = vi.fn();
    await expect(executeAssetBorrowTransaction({
      loanCreate: { data: {} as never, include: {} },
      setAssetInUse,
      buildTransactionCreateData: () => ({ action: 'BORROW' }) as never,
    })).rejects.toMatchObject({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN' });
    expect(setAssetInUse).not.toHaveBeenCalled();
  });

  it('maps a unique violation from setAssetInUse to ASSET_ALREADY_ON_LOAN and skips the transaction record', async () => {
    const setAssetInUse = vi.fn().mockRejectedValue(p2002());
    await expect(executeAssetBorrowTransaction({
      loanCreate: { data: {} as never, include: {} },
      setAssetInUse,
      buildTransactionCreateData: () => ({ action: 'BORROW' }) as never,
    })).rejects.toMatchObject({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN' });
    expect(tx.loan.create).toHaveBeenCalledTimes(1);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('maps a unique violation from transaction.create to ASSET_ALREADY_ON_LOAN', async () => {
    tx.transaction.create.mockRejectedValue(p2002());
    await expect(executeAssetBorrowTransaction({
      loanCreate: { data: {} as never, include: {} },
      setAssetInUse: vi.fn(),
      buildTransactionCreateData: () => ({ action: 'BORROW' }) as never,
    })).rejects.toMatchObject({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN' });
  });

  it('propagates non-unique failures (e.g. inspection save failure) unchanged', async () => {
    const failure = new Error('inspection failed');
    await expect(executeAssetBorrowTransaction({
      loanCreate: { data: {} as never, include: {} },
      setAssetInUse: vi.fn(),
      afterCreate: vi.fn().mockRejectedValue(failure),
      buildTransactionCreateData: () => ({ action: 'BORROW' }) as never,
    })).rejects.toBe(failure);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});

describe('executeAssetReturnTransaction', () => {
  const returnedAt = new Date('2026-11-03T10:00:00Z');
  const base = (assetId: string | null, setAssetAvailable = vi.fn(async () => { calls.push('asset.available'); })) => ({
    loanId: 'loan-1',
    loanUpdate: { data: { returnedAt, returnReceivedAt: new Date('2026-11-03T12:00:00Z') }, include: { employee: true } },
    assetId,
    setAssetAvailable,
    transactionCreate: { loanId: 'loan-1', action: 'RETURN' } as never,
  });

  it('claims the active loan before reloading it, then frees the asset and records the return', async () => {
    const reloaded = { id: 'loan-1', returnedAt, employee: { id: 'e' } };
    tx.loan.findUniqueOrThrow.mockImplementation(async () => { calls.push('loan.reload'); return reloaded; });
    const params = base('mi-1');
    await expect(executeAssetReturnTransaction(params)).resolves.toBe(reloaded);
    expect(calls).toEqual(['loan.claim', 'loan.reload', 'asset.available', 'transaction.create']);
    expect(tx.loan.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'loan-1' }, include: { employee: true } });
    expect(tx.transaction.create).toHaveBeenCalledWith({ data: { loanId: 'loan-1', action: 'RETURN' } });
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { id: 'loan-1', returnedAt: null, cancelledAt: null },
      data: params.loanUpdate.data,
    });
    expect(params.setAssetAvailable).toHaveBeenCalledWith(tx, 'mi-1');
  });

  it('skips the asset status update for loans without an asset id', async () => {
    const reloaded = { id: 'loan-1', returnedAt };
    tx.loan.findUniqueOrThrow.mockImplementation(async () => { calls.push('loan.reload'); return reloaded; });
    const params = base(null);
    await expect(executeAssetReturnTransaction(params)).resolves.toBe(reloaded);
    expect(params.setAssetAvailable).not.toHaveBeenCalled();
    expect(calls).toEqual(['loan.claim', 'loan.reload', 'transaction.create']);
  });

  it('writes nothing else when another terminal already returned the loan', async () => {
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    tx.loan.findUnique.mockResolvedValue({ returnedAt: new Date(), cancelledAt: null });
    const params = base('mi-1');
    await expect(executeAssetReturnTransaction(params)).rejects.toMatchObject({ statusCode: 409, code: 'LOAN_ALREADY_RETURNED' });
    expect(params.setAssetAvailable).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});
