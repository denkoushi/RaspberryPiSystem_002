import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { LoanClientAssignmentService } from '../loan-client-assignment.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    clientDevice: {
      findUnique: vi.fn(),
    },
    transaction: {
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('LoanClientAssignmentService', () => {
  const service = new LoanClientAssignmentService();

  const baseLoan = {
    id: 'loan-1',
    itemId: null,
    measuringInstrumentId: null,
    riggingGearId: 'gear-1',
    employeeId: 'emp-1',
    clientId: null,
    borrowedAt: new Date('2026-03-25T00:00:00Z'),
    dueAt: null,
    returnedAt: null,
    cancelledAt: null,
    notes: null,
    photoUrl: null,
    photoTakenAt: null,
    createdAt: new Date('2026-03-25T00:00:00Z'),
    updatedAt: new Date('2026-03-25T00:00:00Z'),
    item: null,
    measuringInstrument: null,
    riggingGear: { id: 'gear-1', managementNumber: 'RG-1', name: 'Gear 1' },
    employee: { id: 'emp-1', employeeCode: 'E001', displayName: 'Taro', nfcTagUid: null },
    client: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('active loanへclientIdを再紐付けする', async () => {
    const updatedLoan = {
      ...baseLoan,
      clientId: 'client-1',
      client: { id: 'client-1', name: 'Kiosk-1', location: 'A' },
    };

    vi.mocked(prisma.loan.findUnique).mockResolvedValue(baseLoan as never);
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-1' } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: any) => Promise<unknown>) =>
      fn({
        loan: { update: vi.fn().mockResolvedValue(updatedLoan) },
        transaction: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({}) },
      }) as never
    );

    const result = await service.assignClientToActiveLoan({
      loanId: 'loan-1',
      clientId: 'client-1',
      performedByUserId: 'user-1',
    });

    expect(result.clientId).toBe('client-1');
    expect(prisma.loan.findUnique).toHaveBeenCalled();
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({ where: { id: 'client-1' } });
  });

  it('別clientIdが既に紐付いている場合は409を返す', async () => {
    vi.mocked(prisma.loan.findUnique).mockResolvedValue({
      ...baseLoan,
      clientId: 'client-existing',
      client: { id: 'client-existing', name: 'Existing', location: 'X' },
    } as never);
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-new' } as never);

    await expect(
      service.assignClientToActiveLoan({
        loanId: 'loan-1',
        clientId: 'client-new',
      })
    ).rejects.toThrow(ApiError);
    await expect(
      service.assignClientToActiveLoan({
        loanId: 'loan-1',
        clientId: 'client-new',
      })
    ).rejects.toThrow('すでに別のクライアント');
  });
});
