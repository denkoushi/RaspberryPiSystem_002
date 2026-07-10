import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RiggingStatus, TransactionAction } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { RiggingLoanService } from '../loan.service.js';
import { RiggingGearService } from '../rigging-gear.service.js';
import { EmployeeService } from '../../tools/employee.service.js';
import { RiggingBorrowInspectionOrchestrator } from '../inspection/rigging-borrow-inspection.orchestrator.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    riggingGear: {
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../rigging-gear.service.js', () => ({
  RiggingGearService: vi.fn(),
}));

vi.mock('../../tools/employee.service.js', () => ({
  EmployeeService: vi.fn(),
}));

vi.mock('../inspection/rigging-borrow-inspection.orchestrator.js', () => ({
  RiggingBorrowInspectionOrchestrator: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RiggingLoanService', () => {
  let service: RiggingLoanService;
  let mockGearService: RiggingGearService;
  let mockEmployeeService: EmployeeService;
  let mockInspectionOrchestrator: RiggingBorrowInspectionOrchestrator;

  const mockGear = {
    id: 'rigging-123',
    managementNumber: 'RG-001',
    name: 'Test Rigging',
    status: RiggingStatus.AVAILABLE,
  };

  const mockEmployee = {
    id: 'employee-123',
    employeeCode: 'EMP001',
    displayName: 'Test Employee',
    nfcTagUid: '04C362E1330289',
  };

  const mockLoan = {
    id: 'loan-123',
    riggingGearId: 'rigging-123',
    employeeId: 'employee-123',
    clientId: 'client-123',
    borrowedAt: new Date('2025-06-01T10:00:00Z'),
    returnedAt: null,
    dueAt: null,
    notes: null,
    riggingGear: mockGear,
    employee: mockEmployee,
    client: { id: 'client-123', name: 'Test Client', location: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGearService = {
      findByTagUid: vi.fn(),
      findById: vi.fn(),
    } as unknown as RiggingGearService;

    mockEmployeeService = {
      findByNfcTagUid: vi.fn(),
    } as unknown as EmployeeService;

    mockInspectionOrchestrator = {
      recordIfNotDuplicate: vi.fn().mockResolvedValue(undefined),
    } as unknown as RiggingBorrowInspectionOrchestrator;

    service = new RiggingLoanService();
    (service as unknown as { gearService: RiggingGearService }).gearService = mockGearService;
    (service as unknown as { employeeService: EmployeeService }).employeeService =
      mockEmployeeService;
    (service as unknown as { borrowInspectionOrchestrator: RiggingBorrowInspectionOrchestrator }).borrowInspectionOrchestrator =
      mockInspectionOrchestrator;
  });

  describe('borrow', () => {
    it('タグ解決で正常に持出処理が完了する', async () => {
      const input = {
        riggingTagUid: '04DE8366BC2A81',
        employeeTagUid: '04C362E1330289',
        clientId: 'client-123',
        note: 'borrow note',
      };

      vi.mocked(mockGearService.findByTagUid).mockResolvedValue(mockGear as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as never);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);

      let txLoanCreate: ReturnType<typeof vi.fn>;
      let txGearUpdate: ReturnType<typeof vi.fn>;
      let txTransactionCreate: ReturnType<typeof vi.fn>;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        txLoanCreate = vi.fn().mockResolvedValue(mockLoan);
        txGearUpdate = vi.fn().mockResolvedValue(mockGear);
        txTransactionCreate = vi.fn().mockResolvedValue({
          id: 'transaction-123',
          loanId: 'loan-123',
          action: TransactionAction.BORROW,
        });
        return callback({
          loan: { create: txLoanCreate },
          riggingGear: { update: txGearUpdate },
          transaction: { create: txTransactionCreate },
        } as never);
      });

      const result = await service.borrow(input);

      expect(result).toEqual(mockLoan);
      expect(mockGearService.findByTagUid).toHaveBeenCalledWith('04DE8366BC2A81');
      expect(mockEmployeeService.findByNfcTagUid).toHaveBeenCalledWith('04C362E1330289');
      expect(prisma.loan.findFirst).toHaveBeenCalledWith({
        where: {
          riggingGearId: 'rigging-123',
          returnedAt: null,
          cancelledAt: null,
        },
      });
      expect(txLoanCreate!).toHaveBeenCalledWith({
        data: {
          riggingGearId: 'rigging-123',
          employeeId: 'employee-123',
          clientId: 'client-123',
          dueAt: undefined,
          notes: 'borrow note',
        },
        include: { riggingGear: true, employee: true, client: true },
      });
      expect(txGearUpdate!).toHaveBeenCalledWith({
        where: { id: 'rigging-123' },
        data: { status: RiggingStatus.IN_USE },
      });
      expect(txTransactionCreate!).toHaveBeenCalledWith({
        data: {
          loanId: 'loan-123',
          action: TransactionAction.BORROW,
          actorEmployeeId: 'employee-123',
          clientId: 'client-123',
          details: {
            note: 'borrow note',
            riggingSnapshot: {
              id: 'rigging-123',
              managementNumber: 'RG-001',
              name: 'Test Rigging',
            },
            employeeSnapshot: {
              id: 'employee-123',
              code: 'EMP001',
              name: 'Test Employee',
            },
          },
        },
      });
      expect(mockInspectionOrchestrator.recordIfNotDuplicate).toHaveBeenCalledWith({
        riggingGearId: 'rigging-123',
        employeeId: 'employee-123',
        loanId: 'loan-123',
        managementNumber: 'RG-001',
        inspectorName: 'Test Employee',
        inspectedAt: mockLoan.borrowedAt,
        notes: JSON.stringify({ source: 'kiosk' }),
      });
    });

    it('riggingGearId指定で吊具を直接解決して持出する', async () => {
      const input = {
        riggingGearId: 'rigging-123',
        employeeTagUid: '04C362E1330289',
      };

      vi.mocked(mockGearService.findById).mockResolvedValue(mockGear as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as never);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        const tx = {
          loan: { create: vi.fn().mockResolvedValue(mockLoan) },
          riggingGear: { update: vi.fn().mockResolvedValue(mockGear) },
          transaction: { create: vi.fn().mockResolvedValue({ id: 'tx-1' }) },
        };
        return callback(tx as never);
      });

      await service.borrow(input);

      expect(mockGearService.findById).toHaveBeenCalledWith('rigging-123');
      expect(mockGearService.findByTagUid).not.toHaveBeenCalled();
    });

    it('吊具が未選択の場合、400エラーを投げる', async () => {
      await expect(
        service.borrow({ employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 400, message: '吊具が選択されていません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('吊具が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(mockGearService.findByTagUid).mockResolvedValue(null);

      await expect(
        service.borrow({ riggingTagUid: 'INVALID', employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 404, message: '吊具が登録されていません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('廃棄済み吊具の場合、400エラーを投げる', async () => {
      vi.mocked(mockGearService.findByTagUid).mockResolvedValue({
        ...mockGear,
        status: RiggingStatus.RETIRED,
      } as never);

      await expect(
        service.borrow({ riggingTagUid: '04DE8366BC2A81', employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 400, message: '廃棄済みの吊具は持出できません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('従業員が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(mockGearService.findByTagUid).mockResolvedValue(mockGear as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(null);

      await expect(
        service.borrow({ riggingTagUid: '04DE8366BC2A81', employeeTagUid: 'INVALID' }),
      ).rejects.toMatchObject({ statusCode: 404, message: '従業員が登録されていません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('既に貸出中の吊具の場合、400エラーを投げてトランザクションを実行しない', async () => {
      vi.mocked(mockGearService.findByTagUid).mockResolvedValue(mockGear as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as never);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue({
        id: 'existing-loan',
        riggingGearId: 'rigging-123',
        returnedAt: null,
      } as never);

      await expect(
        service.borrow({ riggingTagUid: '04DE8366BC2A81', employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ASSET_ALREADY_ON_LOAN', message: 'この吊具はすでに貸出中です' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockInspectionOrchestrator.recordIfNotDuplicate).not.toHaveBeenCalled();
    });
  });

  describe('return', () => {
    const activeLoan = {
      id: 'loan-123',
      riggingGearId: 'rigging-123',
      employeeId: 'employee-123',
      clientId: 'client-123',
      borrowedAt: new Date('2025-06-01T10:00:00Z'),
      returnedAt: null,
      riggingGear: mockGear,
    };

    const returnedLoan = {
      ...activeLoan,
      returnedAt: new Date('2025-06-02T10:00:00Z'),
      riggingGear: mockGear,
      employee: mockEmployee,
      client: { id: 'client-123', name: 'Test Client', location: null },
    };

    it('正常に返却処理が完了し、点検オーケストレータは呼ばれない', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue(activeLoan as never);

      let txLoanUpdateMany: ReturnType<typeof vi.fn>;
      let txGearUpdate: ReturnType<typeof vi.fn>;
      let txTransactionCreate: ReturnType<typeof vi.fn>;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        txLoanUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
        txGearUpdate = vi.fn().mockResolvedValue({
          ...mockGear,
          status: RiggingStatus.AVAILABLE,
        });
        txTransactionCreate = vi.fn().mockResolvedValue({
          id: 'transaction-456',
          loanId: 'loan-123',
          action: TransactionAction.RETURN,
        });
        return callback({
          loan: {
            updateMany: txLoanUpdateMany,
            findUniqueOrThrow: vi.fn().mockResolvedValue(returnedLoan),
          },
          riggingGear: { update: txGearUpdate },
          transaction: { create: txTransactionCreate },
        } as never);
      });

      const result = await service.return({
        loanId: 'loan-123',
        clientId: 'client-123',
        note: 'return note',
      });

      expect(result).toEqual(returnedLoan);
      expect(prisma.loan.findUnique).toHaveBeenCalledWith({
        where: { id: 'loan-123' },
        include: { riggingGear: true },
      });
      expect(txLoanUpdateMany!).toHaveBeenCalledWith({
        where: { id: 'loan-123', returnedAt: null, cancelledAt: null },
        data: { returnedAt: expect.any(Date), notes: 'return note' },
      });
      expect(txGearUpdate!).toHaveBeenCalledWith({
        where: { id: 'rigging-123' },
        data: { status: RiggingStatus.AVAILABLE },
      });
      expect(txTransactionCreate!).toHaveBeenCalledWith({
        data: {
          loanId: 'loan-123',
          action: TransactionAction.RETURN,
          actorEmployeeId: 'employee-123',
          clientId: 'client-123',
          details: { note: 'return note' },
        },
      });
      expect(mockInspectionOrchestrator.recordIfNotDuplicate).not.toHaveBeenCalled();
    });

    it('note未指定時はdetails.noteがnullになる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue(activeLoan as never);

      let txTransactionCreate: ReturnType<typeof vi.fn>;
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        txTransactionCreate = vi.fn().mockResolvedValue({ id: 'tx-1' });
        return callback({
          loan: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValue(returnedLoan),
          },
          riggingGear: { update: vi.fn().mockResolvedValue(mockGear) },
          transaction: { create: txTransactionCreate },
        } as never);
      });

      await service.return({ loanId: 'loan-123' });

      expect(txTransactionCreate!).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: { note: null },
        }),
      });
      expect(mockInspectionOrchestrator.recordIfNotDuplicate).not.toHaveBeenCalled();
    });

    it('吊具の貸出が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue(null);

      await expect(service.return({ loanId: 'missing-loan' })).rejects.toMatchObject({
        statusCode: 404,
        message: '吊具の貸出が見つかりません',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockInspectionOrchestrator.recordIfNotDuplicate).not.toHaveBeenCalled();
    });

    it('riggingGearIdが欠損している貸出の場合、404エラーを投げる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue({
        id: 'loan-123',
        riggingGearId: null,
        returnedAt: null,
      } as never);

      await expect(service.return({ loanId: 'loan-123' })).rejects.toMatchObject({
        statusCode: 404,
        message: '吊具の貸出が見つかりません',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('既に返却済みの場合、400エラーを投げる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue({
        ...activeLoan,
        returnedAt: new Date(),
      } as never);

      await expect(service.return({ loanId: 'loan-123' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'LOAN_ALREADY_RETURNED',
        message: 'すでに返却済みです',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockInspectionOrchestrator.recordIfNotDuplicate).not.toHaveBeenCalled();
    });
  });
});
