import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MeasuringInstrumentStatus,
  TransactionAction,
} from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { MeasuringInstrumentLoanService } from '../loan.service.js';
import { MeasuringInstrumentService } from '../measuring-instrument.service.js';
import { EmployeeService } from '../../tools/employee.service.js';
import { MeasuringInstrumentLoanEventService } from '../measuring-instrument-loan-event.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    measuringInstrument: {
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../measuring-instrument.service.js', () => ({
  MeasuringInstrumentService: vi.fn(),
}));

vi.mock('../../tools/employee.service.js', () => ({
  EmployeeService: vi.fn(),
}));

vi.mock('../measuring-instrument-loan-event.service.js', () => ({
  MeasuringInstrumentLoanEventService: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('MeasuringInstrumentLoanService', () => {
  let service: MeasuringInstrumentLoanService;
  let mockInstrumentService: MeasuringInstrumentService;
  let mockEmployeeService: EmployeeService;
  let mockLoanEventService: MeasuringInstrumentLoanEventService;

  const mockInstrument = {
    id: 'instrument-123',
    managementNumber: 'MI-001',
    name: 'Test Instrument',
    status: MeasuringInstrumentStatus.AVAILABLE,
  };

  const mockEmployee = {
    id: 'employee-123',
    employeeCode: 'EMP001',
    displayName: 'Test Employee',
    nfcTagUid: '04C362E1330289',
  };

  const mockLoan = {
    id: 'loan-123',
    measuringInstrumentId: 'instrument-123',
    employeeId: 'employee-123',
    clientId: 'client-123',
    borrowedAt: new Date('2025-06-01T10:00:00Z'),
    returnedAt: null,
    dueAt: null,
    notes: null,
    measuringInstrument: mockInstrument,
    employee: mockEmployee,
    client: { id: 'client-123', name: 'Test Client', location: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockInstrumentService = {
      findByTagUid: vi.fn(),
      findById: vi.fn(),
    } as unknown as MeasuringInstrumentService;

    mockEmployeeService = {
      findByNfcTagUid: vi.fn(),
    } as unknown as EmployeeService;

    mockLoanEventService = {
      recordNfcEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as MeasuringInstrumentLoanEventService;

    service = new MeasuringInstrumentLoanService();
    (service as unknown as { instrumentService: MeasuringInstrumentService }).instrumentService =
      mockInstrumentService;
    (service as unknown as { employeeService: EmployeeService }).employeeService =
      mockEmployeeService;
    (service as unknown as { loanEventService: MeasuringInstrumentLoanEventService }).loanEventService =
      mockLoanEventService;
  });

  describe('borrow', () => {
    it('タグ解決で正常に持出処理が完了する', async () => {
      const input = {
        instrumentTagUid: '04DE8366BC2A81',
        employeeTagUid: '04C362E1330289',
        clientId: 'client-123',
        note: 'borrow note',
      };

      vi.mocked(mockInstrumentService.findByTagUid).mockResolvedValue(mockInstrument as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as never);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);

      let txLoanCreate: ReturnType<typeof vi.fn>;
      let txInstrumentUpdate: ReturnType<typeof vi.fn>;
      let txTransactionCreate: ReturnType<typeof vi.fn>;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        txLoanCreate = vi.fn().mockResolvedValue(mockLoan);
        txInstrumentUpdate = vi.fn().mockResolvedValue(mockInstrument);
        txTransactionCreate = vi.fn().mockResolvedValue({
          id: 'transaction-123',
          loanId: 'loan-123',
          action: TransactionAction.BORROW,
        });
        return callback({
          loan: { create: txLoanCreate },
          measuringInstrument: { update: txInstrumentUpdate },
          transaction: { create: txTransactionCreate },
        } as never);
      });

      const result = await service.borrow(input);

      expect(result).toEqual(mockLoan);
      expect(mockInstrumentService.findByTagUid).toHaveBeenCalledWith('04DE8366BC2A81');
      expect(mockEmployeeService.findByNfcTagUid).toHaveBeenCalledWith('04C362E1330289');
      expect(prisma.loan.findFirst).toHaveBeenCalledWith({
        where: {
          measuringInstrumentId: 'instrument-123',
          returnedAt: null,
          cancelledAt: null,
        },
      });
      expect(txLoanCreate!).toHaveBeenCalledWith({
        data: {
          measuringInstrumentId: 'instrument-123',
          employeeId: 'employee-123',
          clientId: 'client-123',
          dueAt: undefined,
          notes: 'borrow note',
        },
        include: { measuringInstrument: true, employee: true, client: true },
      });
      expect(txInstrumentUpdate!).toHaveBeenCalledWith({
        where: { id: 'instrument-123' },
        data: { status: MeasuringInstrumentStatus.IN_USE },
      });
      expect(txTransactionCreate!).toHaveBeenCalledWith({
        data: {
          loanId: 'loan-123',
          action: TransactionAction.BORROW,
          actorEmployeeId: 'employee-123',
          clientId: 'client-123',
          details: {
            note: 'borrow note',
            instrumentSnapshot: {
              id: 'instrument-123',
              managementNumber: 'MI-001',
              name: 'Test Instrument',
            },
            employeeSnapshot: {
              id: 'employee-123',
              code: 'EMP001',
              name: 'Test Employee',
            },
          },
        },
      });
      expect(mockLoanEventService.recordNfcEvent).toHaveBeenCalledWith({
        managementNumber: 'MI-001',
        action: '持ち出し',
        eventAt: mockLoan.borrowedAt,
        borrowerName: 'Test Employee',
        employeeCode: 'EMP001',
        instrumentName: 'Test Instrument',
        expectedReturnAt: null,
        loanId: 'loan-123',
        clientId: 'client-123',
      });
    });

    it('instrumentId指定で計測機器を直接解決して持出する', async () => {
      const input = {
        instrumentId: 'instrument-123',
        employeeTagUid: '04C362E1330289',
      };

      vi.mocked(mockInstrumentService.findById).mockResolvedValue(mockInstrument as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as never);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        const tx = {
          loan: { create: vi.fn().mockResolvedValue(mockLoan) },
          measuringInstrument: { update: vi.fn().mockResolvedValue(mockInstrument) },
          transaction: { create: vi.fn().mockResolvedValue({ id: 'tx-1' }) },
        };
        return callback(tx as never);
      });

      await service.borrow(input);

      expect(mockInstrumentService.findById).toHaveBeenCalledWith('instrument-123');
      expect(mockInstrumentService.findByTagUid).not.toHaveBeenCalled();
    });

    it('計測機器が未選択の場合、400エラーを投げる', async () => {
      await expect(
        service.borrow({ employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 400, message: '計測機器が選択されていません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('計測機器が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(mockInstrumentService.findByTagUid).mockResolvedValue(null);

      await expect(
        service.borrow({ instrumentTagUid: 'INVALID', employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 404, message: '計測機器が登録されていません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('廃棄済み計測機器の場合、400エラーを投げる', async () => {
      vi.mocked(mockInstrumentService.findByTagUid).mockResolvedValue({
        ...mockInstrument,
        status: MeasuringInstrumentStatus.RETIRED,
      } as never);

      await expect(
        service.borrow({ instrumentTagUid: '04DE8366BC2A81', employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 400, message: '廃棄済みの計測機器は持出できません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('従業員が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(mockInstrumentService.findByTagUid).mockResolvedValue(mockInstrument as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(null);

      await expect(
        service.borrow({ instrumentTagUid: '04DE8366BC2A81', employeeTagUid: 'INVALID' }),
      ).rejects.toMatchObject({ statusCode: 404, message: '従業員が登録されていません' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('既に貸出中の計測機器の場合、400エラーを投げてトランザクションを実行しない', async () => {
      vi.mocked(mockInstrumentService.findByTagUid).mockResolvedValue(mockInstrument as never);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as never);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue({
        id: 'existing-loan',
        measuringInstrumentId: 'instrument-123',
        returnedAt: null,
      } as never);

      await expect(
        service.borrow({ instrumentTagUid: '04DE8366BC2A81', employeeTagUid: '04C362E1330289' }),
      ).rejects.toMatchObject({ statusCode: 400, message: 'この計測機器はすでに貸出中です' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockLoanEventService.recordNfcEvent).not.toHaveBeenCalled();
    });
  });

  describe('return', () => {
    const activeLoan = {
      id: 'loan-123',
      measuringInstrumentId: 'instrument-123',
      employeeId: 'employee-123',
      clientId: 'client-123',
      borrowedAt: new Date('2025-06-01T10:00:00Z'),
      returnedAt: null,
      measuringInstrument: mockInstrument,
    };

    const returnedLoan = {
      ...activeLoan,
      returnedAt: new Date('2025-06-02T10:00:00Z'),
      measuringInstrument: mockInstrument,
      employee: mockEmployee,
      client: { id: 'client-123', name: 'Test Client', location: null },
    };

    it('正常に返却処理が完了し、NFCイベントを記録する', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue(activeLoan as never);

      let txLoanUpdate: ReturnType<typeof vi.fn>;
      let txInstrumentUpdate: ReturnType<typeof vi.fn>;
      let txTransactionCreate: ReturnType<typeof vi.fn>;

      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        txLoanUpdate = vi.fn().mockResolvedValue(returnedLoan);
        txInstrumentUpdate = vi.fn().mockResolvedValue({
          ...mockInstrument,
          status: MeasuringInstrumentStatus.AVAILABLE,
        });
        txTransactionCreate = vi.fn().mockResolvedValue({
          id: 'transaction-456',
          loanId: 'loan-123',
          action: TransactionAction.RETURN,
        });
        return callback({
          loan: { update: txLoanUpdate },
          measuringInstrument: { update: txInstrumentUpdate },
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
        include: { measuringInstrument: true },
      });
      expect(txLoanUpdate!).toHaveBeenCalledWith({
        where: { id: 'loan-123' },
        data: { returnedAt: expect.any(Date), notes: 'return note' },
        include: { measuringInstrument: true, employee: true, client: true },
      });
      expect(txInstrumentUpdate!).toHaveBeenCalledWith({
        where: { id: 'instrument-123' },
        data: { status: MeasuringInstrumentStatus.AVAILABLE },
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
      expect(mockLoanEventService.recordNfcEvent).toHaveBeenCalledWith({
        managementNumber: 'MI-001',
        action: '返却',
        eventAt: returnedLoan.returnedAt,
        borrowerName: 'Test Employee',
        employeeCode: 'EMP001',
        instrumentName: 'Test Instrument',
        loanId: 'loan-123',
        clientId: 'client-123',
      });
    });

    it('note未指定時はdetails.noteがnullになる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue(activeLoan as never);

      let txTransactionCreate: ReturnType<typeof vi.fn>;
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
        txTransactionCreate = vi.fn().mockResolvedValue({ id: 'tx-1' });
        return callback({
          loan: { update: vi.fn().mockResolvedValue(returnedLoan) },
          measuringInstrument: { update: vi.fn().mockResolvedValue(mockInstrument) },
          transaction: { create: txTransactionCreate },
        } as never);
      });

      await service.return({ loanId: 'loan-123' });

      expect(txTransactionCreate!).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: { note: null },
        }),
      });
    });

    it('計測機器の貸出が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue(null);

      await expect(service.return({ loanId: 'missing-loan' })).rejects.toMatchObject({
        statusCode: 404,
        message: '計測機器の貸出が見つかりません',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockLoanEventService.recordNfcEvent).not.toHaveBeenCalled();
    });

    it('measuringInstrumentIdが欠損している貸出の場合、404エラーを投げる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue({
        id: 'loan-123',
        measuringInstrumentId: null,
        returnedAt: null,
      } as never);

      await expect(service.return({ loanId: 'loan-123' })).rejects.toMatchObject({
        statusCode: 404,
        message: '計測機器の貸出が見つかりません',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('既に返却済みの場合、400エラーを投げる', async () => {
      vi.mocked(prisma.loan.findUnique).mockResolvedValue({
        ...activeLoan,
        returnedAt: new Date(),
      } as never);

      await expect(service.return({ loanId: 'loan-123' })).rejects.toMatchObject({
        statusCode: 400,
        message: 'すでに返却済みです',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(mockLoanEventService.recordNfcEvent).not.toHaveBeenCalled();
    });
  });
});
